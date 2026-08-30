import type { ContextCandidate, ContextItem, ContextReason } from './types'

export const scoreWeights: Record<ContextReason, number> = {
	'direct-mention': 100,
	'lexical-match': 50,
	'semantic-match': 40,
	'wiki-link': 25,
	backlink: 20
}

const reasonOrder: ContextReason[] = [
	'direct-mention',
	'lexical-match',
	'semantic-match',
	'wiki-link',
	'backlink'
]

export const mergeCandidates = (candidates: ContextCandidate[]): ContextCandidate[] => {
	const candidatesByFragmentId = new Map<string, ContextCandidate>()

	for (const candidate of candidates) {
		const fragmentId = candidate.fragment.id
		const existing = candidatesByFragmentId.get(fragmentId)

		if (!existing) {
			candidatesByFragmentId.set(fragmentId, {
				...candidate,
				reasons: [...candidate.reasons]
			})
			continue
		}

		candidatesByFragmentId.set(fragmentId, {
			fragment: existing.fragment,
			score: Math.max(existing.score, candidate.score),
			reasons: [...new Set([...existing.reasons, ...candidate.reasons])].sort(
				(left, right) => reasonOrder.indexOf(left) - reasonOrder.indexOf(right)
			)
		})
	}

	return [...candidatesByFragmentId.values()]
}

export const rankCandidates = (candidates: ContextCandidate[]): ContextItem[] =>
	mergeCandidates(candidates)
		.map((candidate) => ({
			...candidate,
			score:
				candidate.score +
				candidate.reasons.reduce((score, reason) => score + scoreWeights[reason], 0)
		}))
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.fragment.title.localeCompare(right.fragment.title) ||
				left.fragment.documentId.localeCompare(right.fragment.documentId) ||
				left.fragment.id.localeCompare(right.fragment.id)
		)
