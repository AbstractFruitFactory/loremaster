import { describe, expect, it } from 'vitest'
import { selectWithinBudget } from './budget'
import type { ContextItem } from './types'

const item = (documentId: string, content: string, score: number): ContextItem => ({
	fragment: {
		id: documentId,
		campaignId: 'campaign',
		documentId,
		title: documentId,
		documentType: 'lore',
		content,
		position: 0,
		contentHash: `${documentId}-hash`
	},
	reasons: ['lexical-match'],
	score
})

describe('context budgeting', () => {
	it('excludes lower-ranked content that exceeds the budget', () => {
		const context = selectWithinBudget(
			[item('varek', 'a'.repeat(24), 100), item('mara', 'b'.repeat(24), 50)],
			10
		)

		expect(context.items.map(({ fragment }) => fragment.documentId)).toEqual(['varek'])
		expect(context.estimatedTokens).toBe(6)
	})

	it('retains the highest-ranked item when it alone exceeds the budget', () => {
		const context = selectWithinBudget(
			[item('varek', 'a'.repeat(80), 100), item('mara', 'b'.repeat(4), 50)],
			10
		)

		expect(context.items.map(({ fragment }) => fragment.documentId)).toEqual(['varek'])
		expect(context.estimatedTokens).toBe(20)
	})
})
