import { describe, expect, it } from 'vitest'
import { formatWikiLinks, parseLoreBlocks, stripDocumentTitle } from './lore-content'

describe('lore content', () => {
	it('strips the document title heading', () => {
		expect(stripDocumentTitle('# Varek\n\nRuns the forge.')).toBe('Runs the forge.')
	})

	it('parses headings, paragraphs, lists, and wiki links', () => {
		expect(
			parseLoreBlocks(`# Varek

Intro paragraph with [[Westgate]].

## Secrets

- Knows the hidden road
- Trusts [[Mara|the gatekeeper]]

Closing note.`)
		).toEqual([
			{ type: 'paragraph', text: 'Intro paragraph with Westgate.' },
			{ type: 'heading', level: 2, text: 'Secrets' },
			{
				type: 'list',
				items: ['Knows the hidden road', 'Trusts the gatekeeper']
			},
			{ type: 'paragraph', text: 'Closing note.' }
		])
	})

	it('formats wiki link labels', () => {
		expect(formatWikiLinks('See [[Ashen Council|the council]]')).toBe('See the council')
	})
})
