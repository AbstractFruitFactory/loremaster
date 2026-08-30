import { runSync } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { inferDocumentType } from './infer-document-type'

describe('document type inference', () => {
	it('uses a recognized vault directory', () => {
		expect(
			runSync(
				inferDocumentType({
					path: 'Locations/Westgate.md',
					title: 'Westgate',
					content: 'A fortified settlement.'
				})
			)
		).toBe('location')
	})

	it('uses document text when the directory is not recognized', () => {
		expect(
			runSync(
				inferDocumentType({
					path: 'Imported/Moonblade.md',
					title: 'Moonblade',
					content: 'An ancient weapon carried by the royal guard.'
				})
			)
		).toBe('item')
	})

	it('falls back to lore when no category is clear', () => {
		expect(
			runSync(
				inferDocumentType({
					path: 'Imported/The-Weave.md',
					title: 'The Weave',
					content: 'A mystery known only through scattered accounts.'
				})
			)
		).toBe('lore')
	})
})
