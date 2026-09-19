import { fail as failEffect, gen, succeed, type Effect } from 'effect/Effect'
import type { Failure } from '../failure.js'
import type { VaultDocument } from '../vault/types.js'
import { commitApplication } from './commit/application.js'
import { commitMutationIdsInOrder } from './commit/application.js'
import { planMutations } from './commit/planning.js'
import type { CampaignImportHistoryRepository } from './import-history.js'
import type { CampaignImportAnalysisStorage, CampaignImportBaseCommitStorage } from './storage.js'
import { MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS } from './types.js'
import type {
	CampaignImportCommitInput,
	CampaignImportCommitData,
	CampaignImportCommitPlanData,
	CampaignImportCompletionData,
	CampaignImportDraft,
	CampaignImportClaimProvenanceRecord,
	CampaignImportProposalResolution,
	SessionProposal
} from './types.js'

export type ImportVault = {
	getDocuments: (campaignId: string) => Effect<VaultDocument[], Failure>
	createDocument: (
		campaignId: string,
		input: {
			documentId?: string
			path: string
			type: VaultDocument['type']
			after?: string[]
			during?: string[]
			eventForm?: VaultDocument['eventForm']
			content: string
			ingestionId?: string
			transcript?: string
			revision?: {
				source: 'ingestion'
				relatedSessionId?: string
				ingestionId: string
				changeSummary: string
				revisionId: string
			}
		}
	) => Effect<VaultDocument, Failure>
	updateDocument: (
		campaignId: string,
		documentId: string,
		input: {
			type: VaultDocument['type']
			aliases?: string[]
			after?: string[]
			during?: string[]
			eventForm?: VaultDocument['eventForm']
			content: string
			expectedRevisionId: string
			expectedPath?: string
			revision?: {
				source: 'ingestion'
				relatedSessionId?: string
				ingestionId: string
				changeSummary: string
				revisionId: string
			}
		}
	) => Effect<VaultDocument, Failure>
}

type CampaignImportCommitStorage = Pick<CampaignImportAnalysisStorage, 'readCampaignImportDraft'> &
	CampaignImportBaseCommitStorage

export const invalidCampaignImportCommit = (
	cause: Record<string, unknown>
): Effect<never, Failure> => failEffect({ domain: 'ingestion', operation: 'commit', cause })

const invalidCommit = invalidCampaignImportCommit

export const campaignImportClaimProvenanceRecords = (
	draft: CampaignImportDraft,
	proposal: SessionProposal,
	result: { documentId: string; revisionId?: string }
): Effect<CampaignImportClaimProvenanceRecord[], Failure> => {
	if (!result.revisionId) {
		return invalidCommit({
			reason: 'missingCommittedRevision',
			proposalId: proposal.proposalId
		})
	}
	const sourceById = new Map(draft.sources.map((source) => [source.sourceId, source]))
	const claimById = new Map(draft.claims.map((claim) => [claim.claimId, claim]))
	const records: CampaignImportClaimProvenanceRecord[] = []
	for (const claimId of proposal.claimIds) {
		const claim = claimById.get(claimId)
		if (!claim) {
			return invalidCommit({
				reason: 'missingCommittedClaim',
				proposalId: proposal.proposalId,
				claimId
			})
		}
		for (const evidence of claim.evidence) {
			const source = sourceById.get(evidence.sourceId)
			if (!source) {
				return invalidCommit({
					reason: 'missingCommittedSource',
					proposalId: proposal.proposalId,
					sourceId: evidence.sourceId
				})
			}
			records.push({
				claim,
				source,
				documentId: result.documentId,
				vaultRevisionId: result.revisionId,
				evidence
			})
		}
	}
	return succeed(records)
}

const resolveProposal = (
	proposal: SessionProposal,
	resolution: CampaignImportProposalResolution | undefined
): Effect<SessionProposal, Failure> => {
	if (proposal.match.kind !== 'unresolved' || proposal.match.candidates.length === 0) {
		if (resolution) {
			return invalidCommit({ reason: 'invalidResolution', proposalId: proposal.proposalId })
		}
		return succeed(proposal)
	}
	if (!resolution) {
		return invalidCommit({ reason: 'unresolvedMatch', proposalId: proposal.proposalId })
	}
	if (resolution.kind === 'create') {
		return proposal.canCreate
			? succeed(proposal)
			: invalidCommit({ reason: 'unresolvedMatch', proposalId: proposal.proposalId })
	}
	const candidate = proposal.match.candidates.find(
		({ documentId, documentType }) =>
			documentId === resolution.documentId && documentType === proposal.documentType
	)
	if (!candidate) {
		return invalidCommit({ reason: 'invalidResolution', proposalId: proposal.proposalId })
	}
	return succeed({
		...proposal,
		operation: 'update-canon',
		documentType: candidate.documentType,
		title: candidate.title,
		match: {
			kind: 'exact',
			documentId: candidate.documentId,
			title: candidate.title,
			documentType: candidate.documentType
		},
		base: { documentId: candidate.documentId, revisionId: candidate.revisionId },
		patch: { kind: 'append', content: proposal.content }
	})
}

export const campaignImportCommit = ({
	history,
	storage,
	vault
}: {
	history: CampaignImportHistoryRepository
	storage: CampaignImportCommitStorage
	vault: ImportVault
}) => {
	const { applyMutationPlan } = commitApplication(vault, storage)

	const validateCommitPayload = (input: CampaignImportCommitInput): Effect<void, Failure> => {
		const resolutionCount = input.resolutions?.length ?? 0
		if (!Number.isSafeInteger(input.expectedReviewRevision) || input.expectedReviewRevision < 0) {
			return invalidCommit({ reason: 'invalidExpectedReviewRevision' })
		}
		if (
			input.selectedProposalIds.length > MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS ||
			resolutionCount > MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS
		) {
			return invalidCommit({
				reason: 'selectionLimitExceeded',
				maximum: MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS,
				selectedProposalCount: input.selectedProposalIds.length,
				resolutionCount
			})
		}
		if (new Set(input.selectedProposalIds).size !== input.selectedProposalIds.length) {
			return invalidCommit({ reason: 'duplicateProposalId' })
		}
		const resolutions = input.resolutions ?? []
		if (new Set(resolutions.map(({ proposalId }) => proposalId)).size !== resolutions.length) {
			return invalidCommit({ reason: 'duplicateResolution' })
		}
		return succeed(undefined)
	}

	const getDraft = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportDraft, Failure> =>
		storage.readCampaignImportDraft(campaignId, ingestionId)

	const persistCommitData = (
		input: CampaignImportCommitInput
	): Effect<CampaignImportCommitData, Failure> =>
		gen(function* () {
			yield* validateCommitPayload(input)
			const data: CampaignImportCommitData = {
				schemaVersion: 1,
				kind: 'campaign-import-commit',
				...input
			}
			yield* storage.writeCampaignImportCommitData(data)
			return data
		})

	const getCommitData = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportCommitData, Failure> =>
		storage.readCampaignImportCommitData(campaignId, ingestionId)

	const planCommit = (
		input: CampaignImportCommitData
	): Effect<CampaignImportCommitPlanData, Failure> =>
		gen(function* () {
			yield* validateCommitPayload(input)
			const existing = yield* storage.readCampaignImportCommitPlan(
				input.campaignId,
				input.ingestionId
			)
			if (existing) return existing
			const draft = yield* getDraft(input.campaignId, input.ingestionId)
			const proposalById = new Map(
				draft.proposals.map((proposal) => [proposal.proposalId, proposal])
			)
			const selectedIds = new Set(input.selectedProposalIds)
			if (
				selectedIds.size !== input.selectedProposalIds.length ||
				[...selectedIds].some((proposalId) => !proposalById.has(proposalId))
			) {
				return yield* invalidCommit({ reason: 'unknownProposal' })
			}
			const resolutions = input.resolutions ?? []
			const resolutionByProposal = new Map(
				resolutions.map((resolution) => [resolution.proposalId, resolution])
			)
			if (
				resolutionByProposal.size !== resolutions.length ||
				resolutions.some(({ proposalId }) => !proposalById.has(proposalId))
			) {
				return yield* invalidCommit({ reason: 'invalidResolution' })
			}
			for (const resolution of resolutions) {
				yield* resolveProposal(proposalById.get(resolution.proposalId)!, resolution)
			}
			const selected = [...selectedIds].map((proposalId) => proposalById.get(proposalId)!)
			if (selected.some(({ operation }) => operation === 'mention-only')) {
				return yield* invalidCommit({ reason: 'unselectableProposal' })
			}
			const resolvedSelected: SessionProposal[] = []
			for (const proposal of selected) {
				resolvedSelected.push(
					yield* resolveProposal(proposal, resolutionByProposal.get(proposal.proposalId))
				)
			}
			const documents = yield* vault.getDocuments(input.campaignId)
			const plan = yield* planMutations(
				input.ingestionId,
				resolvedSelected,
				[],
				undefined,
				documents
			)
			const prepared: CampaignImportCommitPlanData = {
				schemaVersion: 1,
				kind: 'campaign-import-commit-plan',
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				resolvedSelected,
				plan
			}
			yield* storage.writeCampaignImportCommitPlan(prepared)
			return prepared
		})

	const getCommitPlan = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportCommitPlanData, Failure> =>
		gen(function* () {
			const plan = yield* storage.readCampaignImportCommitPlan(campaignId, ingestionId)
			return plan
				? plan
				: yield* failEffect({
						domain: 'ingestionStorage',
						operation: 'readCampaignImportCommitPlan',
						cause: { reason: 'notFound' }
					})
		})

	const applyCommitMutation = (
		input: CampaignImportCommitData,
		prepared: CampaignImportCommitPlanData,
		mutationId: string
	) =>
		gen(function* () {
			const draft = yield* getDraft(input.campaignId, input.ingestionId)
			const planned = prepared.plan.planned.filter((mutation) => mutation.mutationId === mutationId)
			if (!planned.length || prepared.plan.chronologyUpdates.length) {
				return yield* invalidCommit({ reason: 'unknownMutation', mutationId })
			}
			return yield* applyMutationPlan(
				{
					campaignId: input.campaignId,
					ingestionId: input.ingestionId,
					selectedProposalIds: input.selectedProposalIds
				},
				{ kind: 'campaign-import' },
				prepared.resolvedSelected,
				{ ...prepared.plan, planned, chronologyUpdates: [] },
				(result, proposal) => {
					const records = campaignImportClaimProvenanceRecords(draft, proposal, result)
					return gen(function* () {
						const values = yield* records
						return yield* history.recordProvenance(input.campaignId, input.ingestionId, values)
					})
				}
			)
		})

	const finalizeCommit = (
		input: CampaignImportCommitData,
		prepared: CampaignImportCommitPlanData
	): Effect<CampaignImportCompletionData, Failure> =>
		gen(function* () {
			const existing = yield* storage.readCampaignImportCompletion(
				input.campaignId,
				input.ingestionId
			)
			if (existing) return existing
			const mutationIds = commitMutationIdsInOrder(prepared.plan)
			const journal = yield* storage.readCommitJournal(input.campaignId, input.ingestionId)
			const missingMutationIds = mutationIds.filter((mutationId) => !journal?.applied[mutationId])
			if (missingMutationIds.length) {
				return yield* invalidCommit({ reason: 'incompleteCommit', missingMutationIds })
			}
			const draft = yield* getDraft(input.campaignId, input.ingestionId)
			yield* history.persistSourceRevisions(input.campaignId, input.ingestionId, draft.sources)
			const completion: CampaignImportCompletionData = {
				schemaVersion: 1,
				kind: 'campaign-import-completion',
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				documents: mutationIds.flatMap((mutationId) => {
					const result = journal?.applied[mutationId]
					return result?.proposalId && result.documentType
						? [
								{
									proposalId: result.proposalId,
									documentId: result.documentId,
									documentType: result.documentType
								}
							]
						: []
				}),
				finalized: true
			}
			yield* storage.writeCampaignImportCompletion(completion)
			return completion
		})

	return {
		applyCommitMutation,
		commitMutationIds: (prepared: CampaignImportCommitPlanData) =>
			commitMutationIdsInOrder(prepared.plan),
		finalizeCommit,
		getCommitData,
		getCommitPlan,
		persistCommitData,
		planCommit
	}
}
