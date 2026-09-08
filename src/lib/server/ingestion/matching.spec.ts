import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../vault/types'
import { matchDocument } from './matching'

const document = (id: string, title: string, aliases: string[] = []): VaultDocument => ({
	id,
	path: `NPCs/${title}.md`,
	title,
	type: 'npc',
	aliases,
	after: [],
	summary: '',
	content: `# ${title}`,
	links: [],
	currentRevisionId: `${id}-revision`
})

describe('session proposal matching', () => {
	it('automatically matches only one exact title or alias', () => {
		expect(
			matchDocument('The Gatekeeper', [document('varek', 'Varek', ['The Gatekeeper'])])
		).toEqual({
			kind: 'exact',
			documentId: 'varek',
			title: 'Varek',
			documentType: 'npc'
		})

		expect(matchDocument('Varek', [document('one', 'Varek'), document('two', 'Varek')]).kind).toBe(
			'unresolved'
		)
	})

	it('returns ranked lexical candidates without treating them as matches', () => {
		const match = matchDocument('Varek Smith', [
			document('varek', 'Varek the Smith'),
			document('mara', 'Mara')
		])

		expect(match).toMatchObject({
			kind: 'unresolved',
			candidates: [{ documentId: 'varek', revisionId: 'varek-revision', title: 'Varek the Smith' }]
		})
	})
})
