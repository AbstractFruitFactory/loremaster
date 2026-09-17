import { describe, expect, it } from 'vitest'
import type { ConversationSource } from './ConversationFeed.svelte'
import { citedSourceNumbers, parseMessageCitations } from './citations'

const sources: ConversationSource[] = [
	{ id: 'talven', title: 'Captain Ors Talven', type: 'npc' },
	{ id: 'rask', title: 'Raska', type: 'npc' }
]

describe('conversation citations', () => {
	it('turns valid source markers into citation segments', () => {
		expect(
			parseMessageCitations(
				'Talven was dead.[[source:S1]] Raska was imprisoned.[[source:S2]]',
				sources
			)
		).toEqual([
			{ type: 'text', value: 'Talven was dead.' },
			{ type: 'citation', source: sources[0], number: 1 },
			{ type: 'text', value: ' Raska was imprisoned.' },
			{ type: 'citation', source: sources[1], number: 2 }
		])
	})

	it('hides unknown markers rather than linking the wrong source', () => {
		expect(parseMessageCitations('Unknown claim.[[source:S9]]', sources)).toEqual([
			{ type: 'text', value: 'Unknown claim.' }
		])
	})

	it('hides an incomplete marker while the answer is streaming', () => {
		expect(parseMessageCitations('Talven was dead.[[source:S', sources)).toEqual([
			{ type: 'text', value: 'Talven was dead.' }
		])
	})

	it('returns unique cited source numbers', () => {
		expect(citedSourceNumbers('First.[[source:S2]] Again.[[source:S2]]', sources)).toEqual(
			new Set([2])
		)
	})
})
