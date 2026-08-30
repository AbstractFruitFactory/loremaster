import { flip, runSync } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
	extractWikiLinks,
	parseVaultDocument,
	serializeVaultDocument,
	updateDocumentFrontmatter
} from './markdown'

const parseDocument = (path: string, source: string) => runSync(parseVaultDocument(path, source))

describe('vault Markdown', () => {
	it('parses supported frontmatter and separates the body', () => {
		const document = parseDocument(
			'Characters/Varek.md',
			`---
id: char_varek
type: npc
aliases:
  - Varek the Innkeeper
---

# Varek

Varek owns [[The Black Crown]].`
		)

		expect(document).toMatchObject({
			id: 'char_varek',
			path: 'Characters/Varek.md',
			title: 'Varek',
			type: 'npc',
			aliases: ['Varek the Innkeeper'],
			links: ['The Black Crown']
		})
		expect(document.content).toBe('# Varek\n\nVarek owns [[The Black Crown]].')
	})

	it('extracts plain and aliased wiki-link targets once', () => {
		expect(
			extractWikiLinks(
				'Varek lives in [[Westgate]] and works with [[Ashen Council|the council]] in [[Westgate]].'
			)
		).toEqual(['Westgate', 'Ashen Council'])
	})

	it('ignores unsupported embeds, headings, and block references', () => {
		expect(
			extractWikiLinks('![[Portrait.png]] [[Westgate#Market]] [[Varek^secret]] and [[Mara]].')
		).toEqual(['Mara'])
	})

	it('uses the filename when the document has no level-one heading', () => {
		expect(parseDocument('Lore/The Old Road.md', 'An old road.').title).toBe('The Old Road')
	})

	it('serializes only supported frontmatter fields', () => {
		const source = serializeVaultDocument(
			{
				id: 'char_varek',
				type: 'npc',
				aliases: ['Varek the Innkeeper']
			},
			'# Varek'
		)

		expect(parseDocument('Characters/Varek.md', source)).toMatchObject({
			id: 'char_varek',
			type: 'npc',
			aliases: ['Varek the Innkeeper'],
			content: '# Varek'
		})
	})

	it('parses and serializes direct event predecessors', () => {
		const source = serializeVaultDocument(
			{
				id: 'event-e',
				type: 'event',
				after: ['event-c', 'event-d']
			},
			'# Event E'
		)

		expect(parseDocument('Events/Event E.md', source)).toMatchObject({
			id: 'event-e',
			type: 'event',
			after: ['event-c', 'event-d']
		})
	})

	it('preserves existing Obsidian properties when adding required metadata', () => {
		const source = `---
tags:
  - npc
custom: retained
---

# Varek`
		const identified = runSync(updateDocumentFrontmatter(source, { id: 'char_varek', type: 'npc' }))

		expect(identified).toContain('id: char_varek')
		expect(identified).toContain('type: npc')
		expect(identified).toContain('tags:\n  - npc')
		expect(identified).toContain('custom: retained')
		expect(parseDocument('Characters/Varek.md', identified).content).toBe('# Varek')
	})

	it('returns malformed YAML as an expected parsing failure', () => {
		const result = runSync(
			flip(
				parseVaultDocument(
					'Characters/Varek.md',
					`---
aliases: [unterminated
---

# Varek`
				)
			)
		)

		expect(result).toMatchObject({
			domain: 'vault',
			operation: 'parseDocument'
		})
	})

	it('rejects document types outside the app-wide values', () => {
		const result = runSync(
			flip(
				parseVaultDocument(
					'Characters/Varek.md',
					`---
type: character
---

# Varek`
				)
			)
		)

		expect(result).toMatchObject({
			domain: 'vault',
			operation: 'parseDocument',
			cause: { reason: 'invalidDocumentType', type: 'character' }
		})
	})

	it('rejects event predecessors on non-event documents', () => {
		const result = runSync(
			flip(
				parseVaultDocument(
					'Characters/Varek.md',
					`---
type: npc
after:
  - event-a
---

# Varek`
				)
			)
		)

		expect(result).toMatchObject({
			domain: 'vault',
			operation: 'parseDocument',
			cause: { reason: 'eventPredecessorsOnNonEvent', type: 'npc' }
		})
	})
})
