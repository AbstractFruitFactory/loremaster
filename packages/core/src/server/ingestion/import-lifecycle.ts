import { gen, type Effect } from 'effect/Effect'
import type { Failure } from '../failure.js'
import { campaignImportChronologyProvenanceRecords } from './import-chronology.js'
import {
	campaignImportClaimProvenanceRecords,
	invalidCampaignImportCommit
} from './import-commit.js'
import type { CampaignImportHistoryRepository } from './import-history.js'
import type {
	CampaignImportAnalysisStorage,
	CampaignImportBaseCommitStorage,
	CampaignImportChronologyStorage,
	CampaignImportCleanupStorage,
	CampaignImportLifecycleStorage
} from './storage.js'
import type {
	CampaignImportChronologyDispatchData,
	CampaignImportClaimProvenanceRecord,
	CampaignImportLifecycleStorageState,
	CampaignImportSummary
} from './types.js'

type CampaignImportLifecycleDependencies = {
	history: CampaignImportHistoryRepository
	storage: Pick<CampaignImportAnalysisStorage, 'readCampaignImportDraft'> &
		CampaignImportBaseCommitStorage &
		CampaignImportChronologyStorage &
		CampaignImportLifecycleStorage &
		CampaignImportCleanupStorage
}

export const campaignImportLifecycle = ({
	history,
	storage
}: CampaignImportLifecycleDependencies) => {
	const getDraft = (campaignId: string, ingestionId: string) =>
		storage.readCampaignImportDraft(campaignId, ingestionId)

	const list = (campaignId: string): Effect<CampaignImportSummary[], Failure> =>
		storage.listCampaignImports(campaignId)

	const discard = (campaignId: string, ingestionId: string): Effect<void, Failure> =>
		storage.discardCampaignImport(campaignId, ingestionId)

	const recordChronologyDispatch = (
		data: CampaignImportChronologyDispatchData
	): Effect<void, Failure> => storage.writeCampaignImportChronologyDispatch(data)

	const getChronologyDispatch = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportChronologyDispatchData | undefined, Failure> =>
		storage.readCampaignImportChronologyDispatch(campaignId, ingestionId)

	const getLifecycleState = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportLifecycleStorageState, Failure> =>
		storage.readCampaignImportLifecycleState(campaignId, ingestionId)

	const verifyCleanupPermanence = (
		campaignId: string,
		ingestionId: string
	): Effect<void, Failure> =>
		gen(function* () {
			const lifecycle = yield* storage.readCampaignImportLifecycleState(campaignId, ingestionId)
			if (
				lifecycle.chronologyCommitData &&
				lifecycle.chronologyCompletion?.kind !== 'campaign-import-chronology-completion'
			) {
				return yield* invalidCampaignImportCommit({ reason: 'chronologyCommitIncomplete' })
			}
			if (
				(yield* storage.isCampaignImportCleanupVerified(campaignId, ingestionId)) &&
				!lifecycle.chronologyCommitData
			) {
				return
			}
			const draft = yield* getDraft(campaignId, ingestionId)
			const prepared = yield* storage.readCampaignImportCommitPlan(campaignId, ingestionId)
			if (!prepared) {
				return yield* invalidCampaignImportCommit({ reason: 'missingCommitPlan' })
			}
			const journal =
				(yield* storage.readCommitJournal(campaignId, ingestionId)) ??
				(prepared.plan.planned.length
					? undefined
					: { schemaVersion: 1 as const, campaignId, ingestionId, applied: {} })
			if (!journal) return yield* invalidCampaignImportCommit({ reason: 'missingCommitJournal' })
			const proposalById = new Map(
				prepared.resolvedSelected.map((proposal) => [proposal.proposalId, proposal])
			)
			const records: CampaignImportClaimProvenanceRecord[] = []
			for (const result of Object.values(journal.applied)) {
				if (!result.proposalId) continue
				const proposal = proposalById.get(result.proposalId)
				if (!proposal) {
					return yield* invalidCampaignImportCommit({
						reason: 'missingCommittedProposal',
						proposalId: result.proposalId
					})
				}
				records.push(...(yield* campaignImportClaimProvenanceRecords(draft, proposal, result)))
			}
			yield* history.verifyPermanence(campaignId, ingestionId, {
				sources: draft.sources,
				records
			})
			if (lifecycle.chronologyCommitData) {
				const chronologyPlan = yield* storage.readCampaignImportChronologyCommitPlan(
					campaignId,
					ingestionId
				)
				if (!chronologyPlan) {
					return yield* invalidCampaignImportCommit({ reason: 'missingChronologyCommitPlan' })
				}
				const chronologyRecords = yield* campaignImportChronologyProvenanceRecords(
					draft,
					chronologyPlan,
					journal
				)
				yield* history.verifyChronologyPermanence(campaignId, ingestionId, chronologyRecords)
			}
			yield* storage.verifyCampaignImportSourceBodies(campaignId, draft.sources)
			yield* storage.markCampaignImportCleanupVerified(campaignId, ingestionId)
		})

	const isCleanupVerified = (campaignId: string, ingestionId: string): Effect<boolean, Failure> =>
		storage.isCampaignImportCleanupVerified(campaignId, ingestionId)

	const isCleanupStarted = (campaignId: string, ingestionId: string): Effect<boolean, Failure> =>
		storage.isCampaignImportCleanupStarted(campaignId, ingestionId)

	const markCleanupStarted = (campaignId: string, ingestionId: string): Effect<void, Failure> =>
		storage.markCampaignImportCleanupStarted(campaignId, ingestionId)

	const acquireOperationLease = (campaignId: string, ingestionId: string) =>
		storage.acquireCampaignImportOperationLease(campaignId, ingestionId)

	const releaseOperationLease = (
		campaignId: string,
		ingestionId: string,
		lease: Parameters<typeof storage.releaseCampaignImportOperationLease>[2]
	) => storage.releaseCampaignImportOperationLease(campaignId, ingestionId, lease)

	const cleanup = (campaignId: string, ingestionId: string): Effect<void, Failure> =>
		gen(function* () {
			if (!(yield* isCleanupStarted(campaignId, ingestionId))) {
				yield* markCleanupStarted(campaignId, ingestionId)
			}
			yield* verifyCleanupPermanence(campaignId, ingestionId)
			yield* storage.cleanupCampaignImport(campaignId, ingestionId)
		})

	return {
		acquireOperationLease,
		cleanup,
		discard,
		getChronologyDispatch,
		getLifecycleState,
		isCleanupStarted,
		isCleanupVerified,
		list,
		markCleanupStarted,
		recordChronologyDispatch,
		releaseOperationLease,
		verifyCleanupPermanence
	}
}
