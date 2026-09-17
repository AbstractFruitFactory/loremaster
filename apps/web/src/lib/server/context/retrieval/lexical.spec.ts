import { describe, expect, it } from 'vitest'
import { extractSearchTerms } from './lexical'

describe('lexical retrieval', () => {
	it('normalizes searchable words and removes stop words', () => {
		expect(extractSearchTerms('Where is the Silver Sword from Westgate?')).toEqual([
			'silver',
			'sword',
			'westgate'
		])
	})

	it('keeps Unicode letters and numbers', () => {
		expect(extractSearchTerms('Find Éowyn at Gate 123')).toEqual(['find', 'éowyn', 'gate', '123'])
	})
})
