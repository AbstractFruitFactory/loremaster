import { randomUUID } from 'node:crypto'
import { tryPromise } from 'effect/Effect'
import { failure } from '../failure.js'
import type { ObjectStorage } from '../storage/adapter.js'
import {
	CampaignImportOperationLeaseBusyError,
	CampaignImportPermanenceError,
	CampaignImportReviewCommitConflictError,
	CampaignImportReviewLockBusyError,
	CampaignImportReviewLockedError,
	CampaignImportReviewRevisionConflictError,
	CampaignImportSourceIntegrityError,
	CommitStartedIngestionDiscardError,
	ImmutableIngestionConflictError,
	IncompleteCampaignImportCleanupError,
	type CampaignImportStorage,
	type IngestionStorage
} from './storage.js'
import {
	campaignImportContentHash,
	campaignImportSourceId,
	campaignImportSourceRevisionId
} from './ids.js'
import type {
	CampaignImportChronologyCommitData,
	CampaignImportChronologyCommitPlanData,
	CampaignImportChronologyCompletionData,
	CampaignImportChronologyDispatchData,
	CampaignImportChronologyDraft,
	CampaignImportCommitPlanData,
	CampaignImportCompletionData,
	CampaignImportDraft,
	CampaignImportLifecycleStorageState,
	CampaignImportRequestData,
	CampaignImportReviewState,
	CampaignImportSourceData,
	CampaignImportSummary,
	SessionCommitJournal,
	SessionIngestionDraft,
	SessionIngestionSummary,
	SessionTranscriptData
} from './types.js'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const isCode = (cause: unknown, code: string) =>
	typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code
const segment = (value: string) => {
	if (!value || value === '.' || value === '..' || /[/\\]/u.test(value)) {
		throw new CampaignImportSourceIntegrityError()
	}
	return value
}
const parse = <Value>(source: string) => JSON.parse(source) as Value
const sortedUnique = (values: string[]) => [...new Set(values)].sort()
const resolutionKey = (resolution: CampaignImportReviewState['resolutions'][number]) =>
	resolution.kind === 'existing'
		? `${resolution.proposalId}\0${resolution.kind}\0${resolution.documentId}`
		: `${resolution.proposalId}\0${resolution.kind}`

export const objectIngestionStorage = (
	objects: ObjectStorage
): IngestionStorage & CampaignImportStorage => {
	const ingestionRoot = (campaignId: string, ingestionId: string) =>
		`${segment(campaignId)}/.loremaster/ingestions/${segment(ingestionId)}`
	const ingestionPath = (campaignId: string, ingestionId: string, name: string) =>
		`${ingestionRoot(campaignId, ingestionId)}/${name}`
	const ingestionsRoot = (campaignId: string) => `${segment(campaignId)}/.loremaster/ingestions`
	const sourcePath = (campaignId: string, sourceId: string, revisionId: string) =>
		`${segment(campaignId)}/.loremaster/import-sources/${segment(sourceId)}/${segment(revisionId)}.txt`
	const cleanupPath = (campaignId: string, ingestionId: string, suffix: string) =>
		`${segment(campaignId)}/.loremaster/import-cleanups/${segment(ingestionId)}${suffix}.json`
	const operationLockPath = (campaignId: string, ingestionId: string) =>
		`${segment(campaignId)}/.loremaster/import-operation-locks/${segment(ingestionId)}.lock.json`
	const reviewLockPath = (campaignId: string, ingestionId: string) =>
		`${ingestionRoot(campaignId, ingestionId)}/.review-state.lock.json`

	const read = (path: string) => objects.read(path)
	const optional = async <Value>(path: string): Promise<Value | undefined> => {
		try {
			return parse<Value>(await read(path))
		} catch (cause) {
			if (isCode(cause, 'ENOENT')) return undefined
			throw cause
		}
	}
	const exists = async (path: string) => (await optional<unknown>(path)) !== undefined
	const immutable = async (path: string, content: string) => {
		try {
			await objects.create(path, content)
		} catch (cause) {
			if (!isCode(cause, 'EEXIST')) throw cause
			if ((await read(path)) !== content) throw new ImmutableIngestionConflictError()
		}
	}
	const ifAbsent = async (path: string, content: string) => {
		try {
			await objects.create(path, content)
		} catch (cause) {
			if (!isCode(cause, 'EEXIST')) throw cause
		}
	}
	const removePrefix = async (root: string) => {
		const paths = await objects.list(root)
		await Promise.all(paths.map((path) => objects.delete(`${root}/${path}`)))
	}
	const requestFingerprint = (request: CampaignImportRequestData) =>
		JSON.stringify({
			schemaVersion: request.schemaVersion,
			kind: request.kind,
			ingestionId: request.ingestionId,
			campaignId: request.campaignId,
			sources: request.sources.map(
				({
					displayName,
					sourceId,
					sourceRevisionId,
					title,
					mediaType,
					contentHash,
					byteLength
				}) => ({
					displayName,
					sourceId,
					sourceRevisionId,
					title,
					mediaType,
					contentHash,
					byteLength
				})
			)
		})

	type Lock = { ownerToken: string; acquiredAt: string; renewedAt?: string }
	const acquireLock = async (path: string, waitMs: number, staleMs: number, busy: () => Error) => {
		const deadline = Date.now() + waitMs
		while (true) {
			const lock: Lock = { ownerToken: randomUUID(), acquiredAt: new Date().toISOString() }
			try {
				await objects.create(path, json(lock))
				return lock
			} catch (cause) {
				if (!isCode(cause, 'EEXIST')) throw cause
				const current = await optional<Lock>(path)
				const timestamp = Date.parse(current?.renewedAt ?? current?.acquiredAt ?? '')
				if (Number.isFinite(timestamp) && Date.now() - timestamp > staleMs) {
					await objects.delete(path)
					continue
				}
				if (Date.now() >= deadline) throw busy()
				await new Promise((resolve) => setTimeout(resolve, Math.min(10, deadline - Date.now())))
			}
		}
	}
	const releaseLock = async (path: string, lock: Pick<Lock, 'ownerToken'>) => {
		const current = await optional<Lock>(path)
		if (current?.ownerToken !== lock.ownerToken) throw new Error('Storage lock ownership changed')
		await objects.delete(path)
	}
	const withReviewLock = async <Value>(
		campaignId: string,
		ingestionId: string,
		action: () => Promise<Value>
	) => {
		const path = reviewLockPath(campaignId, ingestionId)
		const lock = await acquireLock(path, 500, 30_000, () => new CampaignImportReviewLockBusyError())
		try {
			return await action()
		} finally {
			await releaseLock(path, lock)
		}
	}
	const readJson = <Value, Operation extends string>(
		campaignId: string,
		ingestionId: string,
		name: string,
		operation: Operation
	) =>
		tryPromise({
			try: async () => parse<Value>(await read(ingestionPath(campaignId, ingestionId, name))),
			catch: (cause) => failure('ingestionStorage', operation, cause)
		})
	const lifecycle = async (
		campaignId: string,
		ingestionId: string
	): Promise<CampaignImportLifecycleStorageState> => {
		const path = (name: string) => ingestionPath(campaignId, ingestionId, name)
		const request = await optional<CampaignImportRequestData>(path('request.json'))
		if (
			request?.kind !== 'campaign-import' ||
			request.campaignId !== campaignId ||
			request.ingestionId !== ingestionId
		) {
			const cause = new Error('Campaign import was not found')
			cause.name = 'CampaignImportNotFoundError'
			throw cause
		}
		const [
			draft,
			commitRequested,
			completion,
			chronologyDispatch,
			chronologyDraft,
			chronologyCommitData,
			chronologyCompletion
		] = await Promise.all([
			optional<CampaignImportDraft>(path('analysis.json')),
			exists(path('import-commit-request.json')),
			optional<CampaignImportCompletionData>(path('import-completion.json')),
			optional<CampaignImportChronologyDispatchData>(path('chronology-dispatch.json')),
			optional<CampaignImportChronologyDraft>(path('chronology-analysis.json')),
			optional<CampaignImportChronologyCommitData>(path('chronology-commit-request.json')),
			optional<CampaignImportChronologyCompletionData>(path('chronology-completion.json'))
		])
		return {
			request,
			...(draft ? { draft } : {}),
			commitRequested,
			...(completion ? { completion } : {}),
			...(chronologyDispatch ? { chronologyDispatch } : {}),
			...(chronologyDraft ? { chronologyDraft } : {}),
			...(chronologyCommitData ? { chronologyCommitData } : {}),
			...(chronologyCompletion ? { chronologyCompletion } : {})
		}
	}
	const wrap = <Value, Operation extends string>(
		operation: Operation,
		action: () => Promise<Value>
	) => tryPromise({ try: action, catch: (cause) => failure('ingestionStorage', operation, cause) })

	return {
		write: (draft, transcript) =>
			wrap('write', async () => {
				const data: SessionTranscriptData = {
					schemaVersion: 1,
					ingestionId: draft.ingestionId,
					campaignId: draft.campaignId,
					title: draft.title,
					transcript
				}
				await Promise.all([
					immutable(ingestionPath(draft.campaignId, draft.ingestionId, 'request.json'), json(data)),
					immutable(
						ingestionPath(draft.campaignId, draft.ingestionId, 'transcript.txt'),
						transcript
					),
					immutable(
						ingestionPath(draft.campaignId, draft.ingestionId, 'analysis.json'),
						json(draft)
					)
				])
			}),
		writeTranscriptData: (data) =>
			wrap('writeTranscriptData', async () => {
				await Promise.all([
					immutable(ingestionPath(data.campaignId, data.ingestionId, 'request.json'), json(data)),
					immutable(
						ingestionPath(data.campaignId, data.ingestionId, 'transcript.txt'),
						data.transcript
					)
				])
			}),
		readTranscriptData: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'request.json', 'readTranscriptData'),
		writeDraft: (draft) =>
			wrap('writeDraft', () =>
				immutable(ingestionPath(draft.campaignId, draft.ingestionId, 'analysis.json'), json(draft))
			),
		read: (campaignId, ingestionId) => readJson(campaignId, ingestionId, 'analysis.json', 'read'),
		readTranscript: (campaignId, ingestionId) =>
			wrap('readTranscript', () => read(ingestionPath(campaignId, ingestionId, 'transcript.txt'))),
		writeCampaignImportData: (data, sources: CampaignImportSourceData[]) =>
			wrap('writeCampaignImportData', async () => {
				const byRevision = new Map(sources.map((source) => [source.sourceRevisionId, source]))
				if (sources.length !== data.sources.length || byRevision.size !== data.sources.length)
					throw new CampaignImportSourceIntegrityError()
				for (const [slot, descriptor] of data.sources.entries()) {
					const source = byRevision.get(descriptor.sourceRevisionId)
					if (
						!source ||
						source.displayName !== descriptor.displayName ||
						source.sourceId !== descriptor.sourceId ||
						source.title !== descriptor.title ||
						source.mediaType !== descriptor.mediaType ||
						source.contentHash !== descriptor.contentHash ||
						source.byteLength !== descriptor.byteLength ||
						campaignImportContentHash(source.content) !== descriptor.contentHash ||
						campaignImportSourceId(data.ingestionId, slot) !== descriptor.sourceId ||
						campaignImportSourceRevisionId(descriptor.sourceId, descriptor.contentHash) !==
							descriptor.sourceRevisionId ||
						Buffer.byteLength(source.content) !== descriptor.byteLength
					)
						throw new CampaignImportSourceIntegrityError()
				}
				const requestPath = ingestionPath(data.campaignId, data.ingestionId, 'request.json')
				let canonical = data
				try {
					await immutable(requestPath, json(data))
				} catch (cause) {
					if (!(cause instanceof ImmutableIngestionConflictError)) throw cause
					const existing = parse<CampaignImportRequestData>(await read(requestPath))
					if (
						typeof existing.createdAt !== 'string' ||
						requestFingerprint(existing) !== requestFingerprint(data)
					)
						throw cause
					canonical = existing
				}
				await Promise.all(
					data.sources.map(({ sourceId, sourceRevisionId }) =>
						immutable(
							sourcePath(data.campaignId, sourceId, sourceRevisionId),
							byRevision.get(sourceRevisionId)!.content
						)
					)
				)
				return canonical
			}),
		readCampaignImportData: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'request.json', 'readCampaignImportData'),
		readCampaignImportSource: (campaignId, sourceId, revisionId) =>
			wrap('readCampaignImportSource', () => read(sourcePath(campaignId, sourceId, revisionId))),
		writeCampaignImportDraft: (draft) =>
			wrap('writeCampaignImportDraft', () =>
				immutable(ingestionPath(draft.campaignId, draft.ingestionId, 'analysis.json'), json(draft))
			),
		readCampaignImportDraft: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'analysis.json', 'readCampaignImportDraft'),
		initializeCampaignImportReviewState: (state) =>
			wrap('initializeCampaignImportReviewState', () =>
				withReviewLock(state.campaignId, state.ingestionId, () =>
					ifAbsent(
						ingestionPath(state.campaignId, state.ingestionId, 'review-state.json'),
						json(state)
					)
				)
			),
		writeCampaignImportReviewState: (state) =>
			wrap('writeCampaignImportReviewState', () =>
				withReviewLock(state.campaignId, state.ingestionId, async () => {
					if (
						await exists(
							ingestionPath(state.campaignId, state.ingestionId, 'import-commit-request.json')
						)
					)
						throw new CampaignImportReviewLockedError()
					await objects.write(
						ingestionPath(state.campaignId, state.ingestionId, 'review-state.json'),
						json(state)
					)
				})
			),
		readCampaignImportReviewState: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'review-state.json', 'readCampaignImportReviewState'),
		updateCampaignImportReviewState: (state, expectedRevision) =>
			wrap('updateCampaignImportReviewState', () =>
				withReviewLock(state.campaignId, state.ingestionId, async () => {
					if (
						await exists(
							ingestionPath(state.campaignId, state.ingestionId, 'import-commit-request.json')
						)
					)
						throw new CampaignImportReviewLockedError()
					const current = parse<CampaignImportReviewState>(
						await read(ingestionPath(state.campaignId, state.ingestionId, 'review-state.json'))
					)
					if (current.revision !== expectedRevision || state.revision !== expectedRevision + 1)
						throw new CampaignImportReviewRevisionConflictError(expectedRevision, current.revision)
					await objects.write(
						ingestionPath(state.campaignId, state.ingestionId, 'review-state.json'),
						json(state)
					)
					return state
				})
			),
		writeCampaignImportCommitData: (data) =>
			wrap('writeCampaignImportCommitData', () =>
				withReviewLock(data.campaignId, data.ingestionId, async () => {
					const review = parse<CampaignImportReviewState>(
						await read(ingestionPath(data.campaignId, data.ingestionId, 'review-state.json'))
					)
					if (review.revision !== data.expectedReviewRevision)
						throw new CampaignImportReviewCommitConflictError('staleRevision')
					const selected = sortedUnique(data.selectedProposalIds)
					if (JSON.stringify(selected) !== JSON.stringify(sortedUnique(review.selectedProposalIds)))
						throw new CampaignImportReviewCommitConflictError('selectionMismatch')
					const ids = new Set(selected)
					const resolutions = data.resolutions ?? []
					if (
						resolutions.some((item) => !ids.has(item.proposalId)) ||
						JSON.stringify(resolutions.map(resolutionKey).sort()) !==
							JSON.stringify(
								review.resolutions
									.filter((item) => ids.has(item.proposalId))
									.map(resolutionKey)
									.sort()
							)
					)
						throw new CampaignImportReviewCommitConflictError('selectionMismatch')
					await immutable(
						ingestionPath(data.campaignId, data.ingestionId, 'import-commit-request.json'),
						json(data)
					)
				})
			),
		readCampaignImportCommitData: (campaignId, ingestionId) =>
			readJson(
				campaignId,
				ingestionId,
				'import-commit-request.json',
				'readCampaignImportCommitData'
			),
		writeCampaignImportCommitPlan: (data) =>
			wrap('writeCampaignImportCommitPlan', () =>
				immutable(
					ingestionPath(data.campaignId, data.ingestionId, 'import-commit-plan.json'),
					json(data)
				)
			),
		readCampaignImportCommitPlan: (campaignId, ingestionId) =>
			wrap('readCampaignImportCommitPlan', () =>
				optional<CampaignImportCommitPlanData>(
					ingestionPath(campaignId, ingestionId, 'import-commit-plan.json')
				)
			),
		writeCampaignImportCompletion: (data) =>
			wrap('writeCampaignImportCompletion', () =>
				immutable(
					ingestionPath(data.campaignId, data.ingestionId, 'import-completion.json'),
					json(data)
				)
			),
		readCampaignImportCompletion: (campaignId, ingestionId) =>
			wrap('readCampaignImportCompletion', () =>
				optional<CampaignImportCompletionData>(
					ingestionPath(campaignId, ingestionId, 'import-completion.json')
				)
			),
		writeCampaignImportChronologyDispatch: (data) =>
			wrap('writeCampaignImportChronologyDispatch', () =>
				objects.write(
					ingestionPath(data.campaignId, data.ingestionId, 'chronology-dispatch.json'),
					json(data)
				)
			),
		readCampaignImportChronologyDispatch: (campaignId, ingestionId) =>
			wrap('readCampaignImportChronologyDispatch', () =>
				optional<CampaignImportChronologyDispatchData>(
					ingestionPath(campaignId, ingestionId, 'chronology-dispatch.json')
				)
			),
		writeCampaignImportChronologyDraft: (data) =>
			wrap('writeCampaignImportChronologyDraft', () =>
				immutable(
					ingestionPath(data.campaignId, data.ingestionId, 'chronology-analysis.json'),
					json(data)
				)
			),
		readCampaignImportChronologyDraft: (campaignId, ingestionId) =>
			readJson(
				campaignId,
				ingestionId,
				'chronology-analysis.json',
				'readCampaignImportChronologyDraft'
			),
		writeCampaignImportChronologyCommitData: (data) =>
			wrap('writeCampaignImportChronologyCommitData', () =>
				immutable(
					ingestionPath(data.campaignId, data.ingestionId, 'chronology-commit-request.json'),
					json(data)
				)
			),
		readCampaignImportChronologyCommitData: (campaignId, ingestionId) =>
			readJson(
				campaignId,
				ingestionId,
				'chronology-commit-request.json',
				'readCampaignImportChronologyCommitData'
			),
		writeCampaignImportChronologyCommitPlan: (data) =>
			wrap('writeCampaignImportChronologyCommitPlan', () =>
				immutable(
					ingestionPath(data.campaignId, data.ingestionId, 'chronology-commit-plan.json'),
					json(data)
				)
			),
		readCampaignImportChronologyCommitPlan: (campaignId, ingestionId) =>
			wrap('readCampaignImportChronologyCommitPlan', () =>
				optional<CampaignImportChronologyCommitPlanData>(
					ingestionPath(campaignId, ingestionId, 'chronology-commit-plan.json')
				)
			),
		writeCampaignImportChronologyCompletion: (data) =>
			wrap('writeCampaignImportChronologyCompletion', () =>
				immutable(
					ingestionPath(data.campaignId, data.ingestionId, 'chronology-completion.json'),
					json(data)
				)
			),
		readCampaignImportChronologyCompletion: (campaignId, ingestionId) =>
			wrap('readCampaignImportChronologyCompletion', () =>
				optional<CampaignImportChronologyCompletionData>(
					ingestionPath(campaignId, ingestionId, 'chronology-completion.json')
				)
			),
		readCampaignImportLifecycleState: (campaignId, ingestionId) =>
			wrap('readCampaignImportLifecycleState', () => lifecycle(campaignId, ingestionId)),
		listCampaignImports: (campaignId) =>
			wrap('listCampaignImports', async () => {
				const ids = [
					...new Set(
						(await objects.list(ingestionsRoot(campaignId)))
							.map((path) => path.split('/')[0])
							.filter(Boolean)
					)
				]
				const summaries = await Promise.all(
					ids.map(async (ingestionId): Promise<CampaignImportSummary | undefined> => {
						const state = await lifecycle(campaignId, ingestionId).catch(() => undefined)
						if (!state) return undefined
						const phase = state.chronologyCompletion
							? 'ready-to-finish'
							: state.chronologyCommitData
								? 'chronology-committing'
								: state.chronologyDraft
									? 'chronology-review'
									: state.chronologyDispatch?.status === 'failed'
										? 'failed'
										: state.completion
											? 'chronology-analyzing'
											: state.commitRequested
												? 'committing'
												: state.draft
													? 'review'
													: 'analyzing'
						return {
							ingestionId,
							campaignId,
							createdAt: state.draft?.createdAt ?? state.request.createdAt,
							phase,
							canDiscard: !state.commitRequested
						}
					})
				)
				return summaries
					.filter((item): item is CampaignImportSummary => Boolean(item))
					.sort(
						(a, b) =>
							b.createdAt.localeCompare(a.createdAt) || a.ingestionId.localeCompare(b.ingestionId)
					)
			}),
		discardCampaignImport: (campaignId, ingestionId) =>
			wrap('discardCampaignImport', async () => {
				const request = await optional<CampaignImportRequestData>(
					ingestionPath(campaignId, ingestionId, 'request.json')
				)
				if (request?.kind !== 'campaign-import') return
				if (await exists(ingestionPath(campaignId, ingestionId, 'import-commit-request.json')))
					throw new CommitStartedIngestionDiscardError()
				await removePrefix(ingestionRoot(campaignId, ingestionId))
			}),
		verifyCampaignImportSourceBodies: (campaignId, sources) =>
			wrap('verifyCampaignImportSourceBodies', async () => {
				const invalid: string[] = []
				for (const source of sources) {
					try {
						const content = await read(
							sourcePath(campaignId, source.sourceId, source.sourceRevisionId)
						)
						if (
							campaignImportContentHash(content) !== source.contentHash ||
							Buffer.byteLength(content) !== source.byteLength
						)
							invalid.push(source.sourceRevisionId)
					} catch (cause) {
						if (isCode(cause, 'ENOENT')) invalid.push(source.sourceRevisionId)
						else throw cause
					}
				}
				if (invalid.length)
					throw new CampaignImportPermanenceError({ missingOrInvalidSourceRevisionIds: invalid })
			}),
		isCampaignImportCleanupStarted: (campaignId, ingestionId) =>
			wrap(
				'isCampaignImportCleanupStarted',
				async () =>
					(await exists(cleanupPath(campaignId, ingestionId, '.started'))) ||
					(await exists(cleanupPath(campaignId, ingestionId, '')))
			),
		isCampaignImportCleanupVerified: (campaignId, ingestionId) =>
			wrap('isCampaignImportCleanupVerified', () =>
				exists(cleanupPath(campaignId, ingestionId, ''))
			),
		markCampaignImportCleanupStarted: (campaignId, ingestionId) =>
			wrap('markCampaignImportCleanupStarted', () =>
				immutable(
					cleanupPath(campaignId, ingestionId, '.started'),
					json({
						schemaVersion: 1,
						kind: 'campaign-import-cleanup-started',
						campaignId,
						ingestionId,
						started: true
					})
				)
			),
		markCampaignImportCleanupVerified: (campaignId, ingestionId) =>
			wrap('markCampaignImportCleanupVerified', () =>
				immutable(
					cleanupPath(campaignId, ingestionId, ''),
					json({
						schemaVersion: 1,
						kind: 'campaign-import-cleanup-verification',
						campaignId,
						ingestionId,
						verified: true
					})
				)
			),
		acquireCampaignImportOperationLease: (campaignId, ingestionId) =>
			wrap('acquireCampaignImportOperationLease', () =>
				acquireLock(
					operationLockPath(campaignId, ingestionId),
					0,
					30 * 60_000,
					() => new CampaignImportOperationLeaseBusyError()
				)
			),
		releaseCampaignImportOperationLease: (campaignId, ingestionId, lease) =>
			wrap('releaseCampaignImportOperationLease', () =>
				releaseLock(operationLockPath(campaignId, ingestionId), lease)
			),
		writeCommitData: (data) =>
			wrap('writeCommitData', () =>
				immutable(
					ingestionPath(data.campaignId, data.ingestionId, 'commit-request.json'),
					json(data)
				)
			),
		readCommitData: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'commit-request.json', 'readCommitData'),
		readCommitJournal: (campaignId, ingestionId) =>
			wrap('readCommitJournal', () =>
				optional<SessionCommitJournal>(
					ingestionPath(campaignId, ingestionId, 'commit-journal.json')
				)
			),
		writeCommitJournal: (journal) =>
			wrap('writeCommitJournal', () =>
				objects.write(
					ingestionPath(journal.campaignId, journal.ingestionId, 'commit-journal.json'),
					json(journal)
				)
			),
		list: (campaignId) =>
			wrap('list', async () => {
				const ids = [
					...new Set(
						(await objects.list(ingestionsRoot(campaignId)))
							.map((path) => path.split('/')[0])
							.filter(Boolean)
					)
				]
				const values = await Promise.all(
					ids.map(async (ingestionId): Promise<SessionIngestionSummary | undefined> => {
						const request = await optional<SessionTranscriptData>(
							ingestionPath(campaignId, ingestionId, 'request.json')
						)
						if (!request || ('kind' in request && request.kind === 'campaign-import'))
							return undefined
						const draft = await optional<SessionIngestionDraft>(
							ingestionPath(campaignId, ingestionId, 'analysis.json')
						)
						const committed = await exists(
							ingestionPath(campaignId, ingestionId, 'commit-request.json')
						)
						return {
							ingestionId,
							campaignId,
							title: request.title,
							createdAt: draft?.createdAt ?? new Date(0).toISOString(),
							phase: committed ? 'committing' : draft ? 'review' : 'analyzing',
							canDiscard: !committed
						}
					})
				)
				return values
					.filter((item): item is SessionIngestionSummary => Boolean(item))
					.sort(
						(a, b) =>
							b.createdAt.localeCompare(a.createdAt) || a.ingestionId.localeCompare(b.ingestionId)
					)
			}),
		discard: (campaignId, ingestionId) =>
			wrap('discard', async () => {
				if (await exists(ingestionPath(campaignId, ingestionId, 'commit-request.json')))
					throw new CommitStartedIngestionDiscardError()
				await removePrefix(ingestionRoot(campaignId, ingestionId))
			}),
		cleanupCampaignImport: (campaignId, ingestionId) =>
			wrap('cleanupCampaignImport', async () => {
				const root = ingestionRoot(campaignId, ingestionId)
				if (!(await objects.list(root)).length) return
				const [request, completion, chronologyRequest, chronologyCompletion] = await Promise.all([
					optional<CampaignImportRequestData>(`${root}/request.json`),
					optional<CampaignImportCompletionData>(`${root}/import-completion.json`),
					optional<CampaignImportChronologyCommitData>(`${root}/chronology-commit-request.json`),
					optional<CampaignImportChronologyCompletionData>(`${root}/chronology-completion.json`)
				])
				if (
					request?.kind !== 'campaign-import' ||
					request.campaignId !== campaignId ||
					request.ingestionId !== ingestionId ||
					completion?.kind !== 'campaign-import-completion' ||
					completion.campaignId !== campaignId ||
					completion.ingestionId !== ingestionId ||
					(chronologyRequest &&
						(chronologyCompletion?.kind !== 'campaign-import-chronology-completion' ||
							chronologyCompletion.campaignId !== campaignId ||
							chronologyCompletion.ingestionId !== ingestionId))
				)
					throw new IncompleteCampaignImportCleanupError()
				await removePrefix(root)
			})
	}
}
