import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../vault/types'
import { contextualCandidates, matchDocument } from './matching'

const document = (
	id: string,
	title: string,
	aliases: string[] = [],
	overrides: Partial<VaultDocument> = {}
): VaultDocument => ({
	id,
	path: `NPCs/${title}.md`,
	title,
	type: 'npc',
	aliases,
	after: [],
	summary: '',
	content: `# ${title}`,
	links: [],
	currentRevisionId: `${id}-revision`,
	...overrides
})

describe('session entity matching', () => {
	it('matches a unique exact title or alias', () => {
		expect(
			matchDocument('The Gatekeeper', [document('varek', 'Varek', ['The Gatekeeper'])], 'npc')
		).toEqual({
			kind: 'exact',
			documentId: 'varek',
			title: 'Varek',
			documentType: 'npc'
		})

		expect(
			matchDocument('Varek', [document('one', 'Varek'), document('two', 'Varek')], 'npc').kind
		).toBe('unresolved')
	})

	it('resolves an unambiguous partial name but leaves ambiguous names unresolved', () => {
		expect(matchDocument('Mara', [document('mara', 'Mara Vale')], 'npc')).toMatchObject({
			kind: 'exact',
			documentId: 'mara',
			title: 'Mara Vale'
		})

		const match = matchDocument(
			'Vale',
			[document('mara', 'Mara Vale'), document('edric', 'Brother Edric Vale')],
			'npc'
		)
		expect(match).toMatchObject({
			kind: 'unresolved',
			candidates: expect.arrayContaining([
				expect.objectContaining({ documentId: 'mara' }),
				expect.objectContaining({ documentId: 'edric' })
			])
		})
	})

	it('finds relationship candidates around a resolved anchor', () => {
		const elias = document('elias', 'Elias Vey', [], {
			content: '# Elias Vey\n\nHis father was [[Roger]].',
			links: ['Roger']
		})
		const roger = document('roger', 'Roger')
		const mara = document('mara', 'Mara Vale')

		const candidates = contextualCandidates(
			"Elias' father",
			"Elias' father warned him about the gate.",
			[elias, roger, mara],
			'npc'
		)

		expect(candidates).toEqual(
			expect.arrayContaining([expect.objectContaining({ documentId: 'roger', title: 'Roger' })])
		)
	})
})
