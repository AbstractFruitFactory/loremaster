import type {
	CampaignImportProposalResolution,
	CampaignImportReviewState as PersistedCampaignImportReviewState,
	CampaignImportSource,
	Evidence,
	SessionProposal
} from '#lib/server/ingestion/types.js'

export type ReviewStatusFilter = 'all' | 'selected' | 'not-selected'

export type ResolutionChoice = { kind: 'create' } | { kind: 'existing'; documentId: string }

export type CampaignImportReviewState = {
	selected: Record<string, boolean>
	resolutions: Record<string, ResolutionChoice>
}

export const needsIdentityResolution = (proposal: SessionProposal) =>
	proposal.match.kind === 'unresolved' && proposal.match.candidates.length > 0

export const initialResolutionFor = (proposal: SessionProposal): ResolutionChoice | undefined => {
	if (!needsIdentityResolution(proposal)) return undefined
	return proposal.canCreate ? { kind: 'create' } : undefined
}

export const isValidResolutionFor = (
	proposal: SessionProposal,
	resolution: ResolutionChoice | undefined
) => {
	if (!needsIdentityResolution(proposal)) return resolution === undefined
	if (!resolution) return false
	if (resolution.kind === 'create') return proposal.canCreate === true
	return proposal.match.kind === 'unresolved'
		? proposal.match.candidates.some(
				(candidate) =>
					candidate.documentId === resolution.documentId &&
					candidate.documentType === proposal.documentType
			)
		: false
}

export const canSelectProposal = (
	proposal: SessionProposal,
	resolution: ResolutionChoice | undefined
) =>
	proposal.operation !== 'mention-only' &&
	(!needsIdentityResolution(proposal) || isValidResolutionFor(proposal, resolution))

export const sameTypeCandidates = (proposal: SessionProposal) =>
	proposal.match.kind === 'unresolved'
		? proposal.match.candidates.filter(
				(candidate) => candidate.documentType === proposal.documentType
			)
		: []

export const createInitialReviewState = (
	proposals: readonly SessionProposal[]
): CampaignImportReviewState => {
	const selected: Record<string, boolean> = {}
	const resolutions: Record<string, ResolutionChoice> = {}

	for (const proposal of proposals) {
		selected[proposal.proposalId] =
			proposal.operation !== 'mention-only' &&
			proposal.certainty === 'explicit' &&
			proposal.resolutionMethod !== 'model' &&
			!needsIdentityResolution(proposal) &&
			proposal.selected
		const resolution = initialResolutionFor(proposal)
		if (!resolution) continue
		resolutions[proposal.proposalId] = resolution
	}

	return { selected, resolutions }
}

export const reviewChoicesFromServerState = (
	proposals: readonly SessionProposal[],
	state: PersistedCampaignImportReviewState
): CampaignImportReviewState => {
	const proposalIds = new Set(proposals.map(({ proposalId }) => proposalId))
	const selectedIds = new Set(state.selectedProposalIds)
	const selected = Object.fromEntries(
		proposals.map(({ proposalId }) => [proposalId, selectedIds.has(proposalId)])
	)
	const resolutions = Object.fromEntries(
		state.resolutions
			.filter(({ proposalId }) => proposalIds.has(proposalId))
			.map(({ proposalId, ...resolution }) => [proposalId, resolution])
	)
	return { selected, resolutions }
}

export const sourceTitleById = (sources: readonly CampaignImportSource[]) =>
	new Map(sources.map((source) => [source.sourceId, source.title]))

export const evidenceKey = (evidence: Evidence) =>
	[
		evidence.sourceId ?? 'unknown',
		evidence.sourceRevisionId ?? 'unknown',
		evidence.chunkId,
		evidence.startStringIndex,
		evidence.endStringIndex
	].join(':')

export const strongestEvidenceFirst = (evidence: readonly Evidence[]) =>
	[...evidence].sort((left, right) => right.excerpt.trim().length - left.excerpt.trim().length)

export const excerptPreview = (excerpt: string, maximumCharacters = 600) => {
	const content = excerpt.trim()
	if (content.length <= maximumCharacters) return { content, truncated: false }

	const candidate = content.slice(0, maximumCharacters)
	const lastWhitespace = candidate.search(/\s+\S*$/u)
	const breakAt =
		lastWhitespace >= Math.floor(maximumCharacters * 0.75) ? lastWhitespace : maximumCharacters

	return {
		content: `${candidate.slice(0, breakAt).trimEnd()}…`,
		truncated: true
	}
}

export const proposalMatchesFilters = (
	proposal: SessionProposal,
	selected: boolean,
	resolution: ResolutionChoice | undefined,
	sourceId: string,
	status: ReviewStatusFilter
) => {
	if (sourceId !== 'all' && !proposal.evidence.some((evidence) => evidence.sourceId === sourceId)) {
		return false
	}

	if (status === 'selected') return selected
	if (status === 'not-selected') return !selected
	return true
}

export const buildCampaignImportCommitSelection = (
	proposals: readonly SessionProposal[],
	state: CampaignImportReviewState
): {
	selectedProposalIds: string[]
	resolutions: CampaignImportProposalResolution[]
} => {
	const selectedProposalIds: string[] = []
	const resolutions: CampaignImportProposalResolution[] = []

	for (const proposal of proposals) {
		const resolution = state.resolutions[proposal.proposalId]
		if (!state.selected[proposal.proposalId]) continue
		selectedProposalIds.push(proposal.proposalId)
		if (resolution) resolutions.push({ proposalId: proposal.proposalId, ...resolution })
	}

	return { selectedProposalIds, resolutions }
}

export const buildCampaignImportReviewSnapshot = (
	proposals: readonly SessionProposal[],
	state: CampaignImportReviewState
) => ({
	selectedProposalIds: proposals
		.filter((proposal) => state.selected[proposal.proposalId])
		.map(({ proposalId }) => proposalId),
	resolutions: proposals.flatMap((proposal): CampaignImportProposalResolution[] => {
		const resolution = state.resolutions[proposal.proposalId]
		return resolution ? [{ proposalId: proposal.proposalId, ...resolution }] : []
	})
})
