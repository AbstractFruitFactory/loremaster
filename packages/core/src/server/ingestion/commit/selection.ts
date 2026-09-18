import { all, fail as failEffect, flatMap, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { Failure } from '../../failure.js'
import type { VaultDocument } from '../../vault/types.js'
import type { CommitInput, ValidatedClaim } from '../internal.js'
import type { IngestionStorage } from '../storage.js'
import type {
	SessionChronologyProposal,
	SessionIngestionDraft,
	SessionProposal,
	SessionProposalResolution
} from '../types.js'

export const commitSelection = ({
	storage,
	vault
}: {
	storage: IngestionStorage
	vault: { getDocuments: (campaignId: string) => Effect<VaultDocument[], Failure> }
}) => {
	const loadCommitContext = (input: CommitInput) =>
		all([
			storage.read(input.campaignId, input.ingestionId),
			storage.readTranscript(input.campaignId, input.ingestionId),
			vault.getDocuments(input.campaignId)
		])

	const validateSelection = (
		input: CommitInput,
		draft: SessionIngestionDraft
	): Effect<
		{
			selectedIds: Set<string>
			selected: SessionProposal[]
			selectedChronology: SessionChronologyProposal[]
			sessionProposal: SessionProposal
		},
		Failure
	> => {
		const selectedIds = new Set(input.selectedProposalIds)
		const requestedChronologyIds =
			input.selectedChronologyIds ??
			draft.chronology.filter(({ selected }) => selected).map(({ chronologyId }) => chronologyId)
		const selectedChronologyIds = new Set(requestedChronologyIds)
		const selectedChronology = draft.chronology.filter(({ chronologyId }) =>
			selectedChronologyIds.has(chronologyId)
		)
		const selected = draft.proposals.filter(({ proposalId }) => selectedIds.has(proposalId))
		if (
			input.selectedProposalIds.length !== selectedIds.size ||
			selected.length !== selectedIds.size
		) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unknownProposal' }
			} satisfies Failure)
		}
		if (
			requestedChronologyIds.length !== selectedChronologyIds.size ||
			selectedChronology.length !== selectedChronologyIds.size
		) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unknownChronologyProposal' }
			} satisfies Failure)
		}
		const sessionProposal = draft.proposals.find(({ documentType }) => documentType === 'session')
		if (!sessionProposal || !selectedIds.has(sessionProposal.proposalId)) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'sessionProposalRequired' }
			} satisfies Failure)
		}
		if (selected.some((proposal) => proposal.operation === 'mention-only')) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unselectableProposal' }
			} satisfies Failure)
		}
		return succeed({ selectedIds, selected, selectedChronology, sessionProposal })
	}

	const resolutionMapFor = (
		input: CommitInput,
		selectedIds: Set<string>
	): Effect<Map<string, SessionProposalResolution>, Failure> => {
		const resolutions = input.resolutions ?? []
		const resolutionByProposal = new Map(
			resolutions.map((resolution) => [resolution.proposalId, resolution])
		)
		if (
			resolutionByProposal.size !== resolutions.length ||
			resolutions.some(({ proposalId }) => !selectedIds.has(proposalId))
		) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'invalidResolution' }
			} satisfies Failure)
		}
		return succeed(resolutionByProposal)
	}

	const applyProposalResolution = (
		proposal: SessionProposal,
		resolution?: SessionProposalResolution
	): Effect<SessionProposal, Failure> => {
		if (proposal.match.kind !== 'unresolved' || proposal.match.candidates.length === 0) {
			return resolution
				? failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
					} satisfies Failure)
				: succeed(proposal)
		}
		if (!resolution) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unresolvedMatch', proposalId: proposal.proposalId }
			} satisfies Failure)
		}
		if (resolution.kind === 'create') {
			return proposal.canCreate
				? succeed(proposal)
				: failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
					} satisfies Failure)
		}
		const candidate = proposal.match.candidates.find(
			({ documentId }) => documentId === resolution.documentId
		)
		if (!candidate) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
			} satisfies Failure)
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

	const resolveSelectedProposals = (
		input: CommitInput,
		selectedIds: Set<string>,
		selected: SessionProposal[]
	): Effect<SessionProposal[], Failure> =>
		pipe(
			resolutionMapFor(input, selectedIds),
			flatMap((resolutions) =>
				all(
					selected.map((proposal) =>
						applyProposalResolution(proposal, resolutions.get(proposal.proposalId))
					)
				)
			)
		)
	return { loadCommitContext, validateSelection, resolveSelectedProposals }
}
