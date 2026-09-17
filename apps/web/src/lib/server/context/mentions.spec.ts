import { describe, expect, it } from 'vitest'
import { documentMentionNames, mentionCandidates } from './mentions'

describe('direct mention retrieval', () => {
	it('normalizes document titles and aliases once for indexing', () => {
		expect(documentMentionNames('Várek!', ['The Gatekeeper', 'the gatekeeper'])).toEqual([
			'varek',
			'the gatekeeper'
		])
	})

	it('generates normalized contiguous phrases from a message', () => {
		const candidates = mentionCandidates('Ask the Gatekeeper about Westgate.')

		expect(candidates).toContain('the gatekeeper')
		expect(candidates).toContain('westgate')
		expect(candidates).not.toContain('gatekeeper westgate')
	})

	it('does not generate partial words', () => {
		expect(mentionCandidates('The Varekian coast')).not.toContain('varek')
	})
})
