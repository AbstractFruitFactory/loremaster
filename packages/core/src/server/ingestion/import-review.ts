import { fail as failEffect, gen, succeed, type Effect } from 'effect/Effect'
import type { Failure } from '../failure.js'
import type { CampaignImportReviewStorage } from './storage.js'
import type {
	CampaignImportDraft,
	CampaignImportProposalResolution,
	CampaignImportReviewState,
	CampaignImportReviewUpdateInput,
	SessionProposal
} from './types.js'

const invalidReviewState = (cause: Record<string, unknown>): Effect<never, Failure> =>
	failEffect({ domain: 'ingestion', operation: 'saveCampaignImportReviewState', cause })

export const needsCampaignImportIdentityResolution = (proposal: SessionProposal) =>
	proposal.match.kind === 'unresolved' && proposal.match.candidates.length > 0

export const isCampaignImportProposalSelectedByDefault = (proposal: SessionProposal) =>
	proposal.operation !== 'mention-only' &&
	proposal.certainty === 'explicit' &&
	proposal.resolutionMethod !== 'model' &&
	!needsCampaignImportIdentityResolution(proposal) &&
	proposal.selected

export const initialCampaignImportReviewState = (
	draft: CampaignImportDraft
): CampaignImportReviewState => ({
	schemaVersion: 1,
	campaignId: draft.campaignId,
	ingestionId: draft.ingestionId,
	revision: 0,
	updatedAt: draft.createdAt,
	selectedProposalIds: draft.proposals
		.filter(isCampaignImportProposalSelectedByDefault)
		.map(({ proposalId }) => proposalId),
	resolutions: draft.proposals.flatMap((proposal): CampaignImportProposalResolution[] =>
		needsCampaignImportIdentityResolution(proposal) && proposal.canCreate
			? [{ proposalId: proposal.proposalId, kind: 'create' }]
			: []
	)
})

const validateResolution = (
	proposal: SessionProposal,
	resolution: CampaignImportProposalResolution
): Effect<void, Failure> => {
	if (proposal.match.kind !== 'unresolved' || proposal.match.candidates.length === 0) {
		return invalidReviewState({
			reason: 'invalidResolution',
			proposalId: proposal.proposalId
		})
	}
	if (resolution.kind === 'create') {
		return proposal.canCreate
			? succeed(undefined)
			: invalidReviewState({
					reason: 'createNotAllowed',
					proposalId: proposal.proposalId
				})
	}
	const candidate = proposal.match.candidates.find(
		({ documentId }) => documentId === resolution.documentId
	)
	if (!candidate) {
		return invalidReviewState({
			reason: 'unknownResolutionTarget',
			proposalId: proposal.proposalId,
			documentId: resolution.documentId
		})
	}
	return candidate.documentType === proposal.documentType
		? succeed(undefined)
		: invalidReviewState({
				reason: 'resolutionTargetTypeMismatch',
				proposalId: proposal.proposalId,
				documentId: resolution.documentId
			})
}

export const validateCampaignImportReviewUpdate = (
	draft: CampaignImportDraft,
	input: CampaignImportReviewUpdateInput
): Effect<void, Failure> =>
	gen(function* () {
		if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
			return yield* invalidReviewState({ reason: 'invalidExpectedRevision' })
		}
		if (draft.campaignId !== input.campaignId || draft.ingestionId !== input.ingestionId) {
			return yield* invalidReviewState({ reason: 'draftIdentityMismatch' })
		}
		const proposalById = new Map(draft.proposals.map((proposal) => [proposal.proposalId, proposal]))
		const selectedIds = new Set(input.selectedProposalIds)
		if (selectedIds.size !== input.selectedProposalIds.length) {
			return yield* invalidReviewState({ reason: 'duplicateProposalId' })
		}
		for (const proposalId of selectedIds) {
			if (!proposalById.has(proposalId)) {
				return yield* invalidReviewState({ reason: 'unknownProposal', proposalId })
			}
		}
		const resolutionByProposal = new Map(
			input.resolutions.map((resolution) => [resolution.proposalId, resolution])
		)
		if (resolutionByProposal.size !== input.resolutions.length) {
			return yield* invalidReviewState({ reason: 'duplicateResolution' })
		}
		for (const resolution of input.resolutions) {
			const proposal = proposalById.get(resolution.proposalId)
			if (!proposal) {
				return yield* invalidReviewState({
					reason: 'unknownProposal',
					proposalId: resolution.proposalId
				})
			}
			yield* validateResolution(proposal, resolution)
		}
		for (const proposalId of selectedIds) {
			const proposal = proposalById.get(proposalId)!
			if (proposal.operation === 'mention-only') {
				return yield* invalidReviewState({ reason: 'unselectableProposal', proposalId })
			}
			if (
				needsCampaignImportIdentityResolution(proposal) &&
				!resolutionByProposal.has(proposalId)
			) {
				return yield* invalidReviewState({ reason: 'unresolvedMatch', proposalId })
			}
		}
	})

export const campaignImportReview = ({
	storage,
	now = () => new Date().toISOString()
}: {
	storage: Pick<
		CampaignImportReviewStorage,
		| 'initializeCampaignImportReviewState'
		| 'readCampaignImportReviewState'
		| 'updateCampaignImportReviewState'
	>
	now?: () => string
}) => {
	const initialize = (draft: CampaignImportDraft): Effect<void, Failure> =>
		storage.initializeCampaignImportReviewState(initialCampaignImportReviewState(draft))

	const getState = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportReviewState, Failure> =>
		storage.readCampaignImportReviewState(campaignId, ingestionId)

	const saveState = (
		draft: CampaignImportDraft,
		input: CampaignImportReviewUpdateInput
	): Effect<CampaignImportReviewState, Failure> =>
		gen(function* () {
			yield* validateCampaignImportReviewUpdate(draft, input)
			return yield* storage.updateCampaignImportReviewState(
				{
					schemaVersion: 1,
					campaignId: input.campaignId,
					ingestionId: input.ingestionId,
					revision: input.expectedRevision + 1,
					updatedAt: now(),
					selectedProposalIds: input.selectedProposalIds,
					resolutions: input.resolutions
				},
				input.expectedRevision
			)
		})

	return { getState, initialize, saveState }
}
