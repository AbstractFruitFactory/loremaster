import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../vault/types'
import { contextualCandidates, identityCandidates, matchDocument } from './matching'

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
	...overrides,
	during: overrides.during ?? []
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

	it('keeps partial names as identity candidates rather than deterministic matches', () => {
		expect(matchDocument('Mara', [document('mara', 'Mara Vale')], 'npc')).toMatchObject({
			kind: 'unresolved',
			candidates: [expect.objectContaining({ documentId: 'mara', title: 'Mara Vale' })]
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

	it('tracks credible name provenance without accepting incidental overlap', () => {
		const crown = document('crown', 'Eight-Fragment Crown', [], { type: 'item' })
		const fragment = document('fragment', 'Ninth Fragment', [], { type: 'item' })
		const war = document('war', 'Nine Banners War', [], { type: 'event' })
		const present = document('wyrmfall', 'Party reaches Wyrmfall', [], { type: 'event' })

		expect(identityCandidates('Eight-Fragment Crown', [crown, fragment], 'item')).toEqual([
			expect.objectContaining({
				provenance: 'exact-name',
				candidate: expect.objectContaining({ documentId: 'crown' })
			})
		])
		expect(identityCandidates('Eight-Fragment Crown', [fragment], 'item')).toEqual([])
		expect(identityCandidates('War of Nine Banners', [war, present], 'event')).toEqual([
			expect.objectContaining({
				provenance: 'partial-name',
				candidate: expect.objectContaining({ documentId: 'war' })
			})
		])
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
