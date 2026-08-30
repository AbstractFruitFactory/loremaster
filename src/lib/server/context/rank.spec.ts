import { describe, expect, it } from 'vitest'
import { rankCandidates } from './rank'
import type { ContextCandidate, ContextFragment, ContextReason } from './types'

const fragment = (documentId: string, title = documentId): ContextFragment => ({
	id: documentId,
	campaignId: 'campaign',
	documentId,
	title,
	documentType: 'lore',
	content: title,
	position: 0,
	contentHash: `${documentId}-hash`
})

const candidate = (documentId: string, reasons: ContextReason[], score = 0): ContextCandidate => ({
	fragment: fragment(documentId),
	reasons,
	score
})

describe('context ranking', () => {
	it('merges duplicate documents and combines retrieval reasons', () => {
		const [ranked] = rankCandidates([
			candidate('varek', ['direct-mention']),
			candidate('varek', ['lexical-match'], 6),
			candidate('varek', ['backlink'])
		])

		expect(ranked).toMatchObject({
			fragment: { documentId: 'varek' },
			reasons: ['direct-mention', 'lexical-match', 'backlink'],
			score: 176
		})
	})

	it('ranks multiple relevance signals above a single signal', () => {
		const ranked = rankCandidates([
			candidate('mara', ['direct-mention']),
			candidate('varek', ['direct-mention']),
			candidate('varek', ['semantic-match'], 7)
		])

		expect(ranked.map(({ fragment }) => fragment.documentId)).toEqual(['varek', 'mara'])
		expect(ranked[0]?.score).toBe(147)
	})

	it('retains distinct fragments from the same document', () => {
		const first = candidate('varek', ['direct-mention'])
		const second = {
			...candidate('varek', ['lexical-match']),
			fragment: { ...fragment('varek'), id: 'varek:second' }
		}

		const ranked = rankCandidates([first, second])

		expect(ranked.map(({ fragment }) => fragment.id)).toEqual(['varek', 'varek:second'])
	})
})
