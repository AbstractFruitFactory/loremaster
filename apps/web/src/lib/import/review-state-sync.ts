import type { CampaignImportProposalResolution } from '#lib/server/ingestion/types.js'

export type CampaignImportReviewSnapshot = {
	selectedProposalIds: string[]
	resolutions: CampaignImportProposalResolution[]
}

export type CampaignImportReviewSyncStatus = {
	phase: 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict'
	revision: number
}

type SaveReviewState = (
	input: CampaignImportReviewSnapshot & { expectedRevision: number }
) => Promise<{ revision: number }>

const copySnapshot = (snapshot: CampaignImportReviewSnapshot): CampaignImportReviewSnapshot => ({
	selectedProposalIds: [...snapshot.selectedProposalIds],
	resolutions: snapshot.resolutions.map((resolution) => ({ ...resolution }))
})

const errorStatus = (error: unknown) => {
	if (typeof error !== 'object' || error === null || !('status' in error)) return 'error'
	return error.status === 409 ? 'conflict' : 'error'
}

export const createCampaignImportReviewStateSync = ({
	initialRevision,
	save,
	onStatus,
	debounceMs = 500
}: {
	initialRevision: number
	save: SaveReviewState
	onStatus: (status: CampaignImportReviewSyncStatus) => void
	debounceMs?: number
}) => {
	let acknowledgedRevision = initialRevision
	let latestSnapshot: CampaignImportReviewSnapshot | undefined
	let changeVersion = 0
	let acknowledgedVersion = 0
	let timer: ReturnType<typeof setTimeout> | undefined
	let activeSave: Promise<boolean> | undefined
	let phase: CampaignImportReviewSyncStatus['phase'] = 'idle'

	const emit = (nextPhase: CampaignImportReviewSyncStatus['phase']) => {
		phase = nextPhase
		onStatus({ phase, revision: acknowledgedRevision })
	}

	const drain = async () => {
		while (latestSnapshot && acknowledgedVersion < changeVersion) {
			const targetVersion = changeVersion
			const snapshot = copySnapshot(latestSnapshot)
			emit('saving')
			try {
				const saved = await save({
					expectedRevision: acknowledgedRevision,
					...snapshot
				})
				acknowledgedRevision = saved.revision
				acknowledgedVersion = targetVersion
			} catch (error) {
				emit(errorStatus(error))
				return false
			}
		}
		emit('saved')
		return true
	}

	const flush = async (): Promise<boolean> => {
		if (timer) clearTimeout(timer)
		timer = undefined
		if (phase === 'conflict') return false
		if (!latestSnapshot || acknowledgedVersion === changeVersion) {
			if (phase !== 'saved') emit('saved')
			return true
		}
		activeSave ??= drain().finally(() => {
			activeSave = undefined
		})
		const succeeded = await activeSave
		if (!succeeded) return false
		return acknowledgedVersion === changeVersion ? true : flush()
	}

	const schedule = (snapshot: CampaignImportReviewSnapshot) => {
		if (phase === 'conflict') return
		latestSnapshot = copySnapshot(snapshot)
		changeVersion += 1
		emit('pending')
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			void flush()
		}, debounceMs)
	}

	return {
		schedule,
		flush,
		dispose: () => {
			const hasPendingSnapshot = acknowledgedVersion !== changeVersion
			if (timer) clearTimeout(timer)
			timer = undefined
			if (hasPendingSnapshot) void flush()
		},
		hasPendingChanges: () => acknowledgedVersion !== changeVersion,
		getAcknowledgedRevision: () => acknowledgedRevision
	}
}
