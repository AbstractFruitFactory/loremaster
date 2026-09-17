import { describe, expect, it } from 'vitest'
import { resolveVaultLinks } from './links'

describe('vault links', () => {
	it('resolves a target name to a unique document ID', () => {
		expect(
			resolveVaultLinks(['Westgate'], [{ id: 'location-westgate', title: 'Westgate' }])
		).toEqual([{ targetName: 'Westgate', targetDocumentId: 'location-westgate' }])
	})

	it('keeps missing and ambiguous targets unresolved', () => {
		expect(
			resolveVaultLinks(
				['Unknown Ruins', 'The Tower'],
				[
					{ id: 'tower-one', title: 'The Tower' },
					{ id: 'tower-two', title: 'The Tower' }
				]
			)
		).toEqual([
			{ targetName: 'Unknown Ruins', targetDocumentId: null },
			{ targetName: 'The Tower', targetDocumentId: null }
		])
	})
})
