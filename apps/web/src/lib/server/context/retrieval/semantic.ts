import type { ContextCandidate, ContextSource, SemanticSearchResult } from '../types'

export const SEMANTIC_SCORE_SCALE = 10

export const retrieveSemanticMatches = (
	campaignId: string,
	results: SemanticSearchResult[],
	sources: ContextSource[]
): ContextCandidate[] => {
	const sourcesByFragmentId = new Map(
		sources
			.filter(({ fragment }) => fragment.campaignId === campaignId)
			.map((source) => [source.fragment.id, source])
	)
	const scoresByFragmentId = new Map<string, number>()

	for (const { fragmentId, score } of results) {
		if (!sourcesByFragmentId.has(fragmentId)) continue

		scoresByFragmentId.set(fragmentId, Math.max(scoresByFragmentId.get(fragmentId) ?? 0, score))
	}

	return [...scoresByFragmentId]
		.map(([fragmentId, score]): ContextCandidate => ({
			fragment: sourcesByFragmentId.get(fragmentId)!.fragment,
			score: Math.max(0, score) * SEMANTIC_SCORE_SCALE,
			reasons: ['semantic-match']
		}))
		.sort(
			(left, right) => right.score - left.score || left.fragment.id.localeCompare(right.fragment.id)
		)
}
