import { describe, expect, it } from 'vitest'
import type { ContextSource } from '../types'
import { retrieveSemanticMatches } from './semantic'

const source = (
	campaignId: string,
	documentId: string,
	id = `${documentId}:fragment`
): ContextSource => ({
	fragment: {
		id,
		campaignId,
		documentId,
		title: documentId,
		documentType: 'lore',
		content: documentId,
		position: 0,
		contentHash: `${documentId}-hash`
	}
})

describe('semantic retrieval', () => {
	it('maps vector results to current campaign fragments in score order', () => {
		const candidates = retrieveSemanticMatches(
			'campaign-a',
			[
				{ fragmentId: 'mara:fragment', score: 0.6 },
				{ fragmentId: 'varek:fragment', score: 0.8 },
				{ fragmentId: 'stale', score: 1 }
			],
			[
				source('campaign-a', 'varek'),
				source('campaign-a', 'mara'),
				source('campaign-b', 'stale', 'stale')
			]
		)

		expect(candidates).toMatchObject([
			{
				fragment: { documentId: 'varek' },
				score: 8,
				reasons: ['semantic-match']
			},
			{
				fragment: { documentId: 'mara' },
				score: 6,
				reasons: ['semantic-match']
			}
		])
	})

	it('keeps only the strongest duplicate result for a fragment', () => {
		const [candidate] = retrieveSemanticMatches(
			'campaign-a',
			[
				{ fragmentId: 'varek:fragment', score: 0.4 },
				{ fragmentId: 'varek:fragment', score: 0.7 }
			],
			[source('campaign-a', 'varek')]
		)

		expect(candidate?.score).toBe(7)
	})
})
