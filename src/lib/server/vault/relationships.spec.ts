import { describe, expect, it } from 'vitest'
import {
	isValidRelationship,
	normalizeRelationship,
	relationshipCandidates,
	validateRelationshipLinks
} from './relationships'
import type { VaultDocument } from './types'

const document = (
	overrides: Partial<VaultDocument> & Pick<VaultDocument, 'id' | 'title'>
): VaultDocument => {
	const { id, title, ...rest } = overrides
	return {
		id,
		path: `${title}.md`,
		title,
		type: 'npc',
		after: [],
		summary: '',
		content: '',
		links: [],
		...rest
	}
}

describe('relationship links', () => {
	it('finds bounded entity candidates from links, full names, aliases, and unique lead names', () => {
		const mara = document({
			id: 'mara',
			title: 'Mara Vale',
			content: "Mara is Edric Vale's daughter and works with Greyhaven's Gatekeeper.",
			links: ['Greyhaven']
		})
		const edric = document({ id: 'edric', title: 'Edric Vale' })
		const greyhaven = document({ id: 'greyhaven', title: 'Greyhaven', type: 'location' })
		const varek = document({ id: 'varek', title: 'Varek', aliases: ['The Gatekeeper'] })
		const event = document({ id: 'flood', title: 'Blackwater Flood', type: 'event' })
		const session = document({ id: 'session', title: 'Session 4', type: 'session' })

		expect(relationshipCandidates(mara, [mara, edric, greyhaven, varek, event, session])).toEqual([
			edric,
			greyhaven,
			varek
		])
	})

	it('normalizes concise free-form relationships and rejects overlong labels', () => {
		expect(normalizeRelationship('  Daughter   Of ')).toBe('daughter of')
		expect(isValidRelationship('serves as advisor to')).toBe(true)
		expect(isValidRelationship('seems to secretly work for')).toBe(false)
		expect(isValidRelationship('x'.repeat(49))).toBe(false)
	})

	it('accepts only supplied targets and deduplicates normalized relationships', () => {
		expect(
			validateRelationshipLinks(
				[
					{ targetDocumentId: 'edric', relationship: ' Daughter   Of ' },
					{ targetDocumentId: 'edric', relationship: 'daughter of' },
					{ targetDocumentId: 'unknown', relationship: 'works for' },
					{ targetDocumentId: 'edric', relationship: 'is maybe secretly working for' }
				],
				[{ id: 'edric' }]
			)
		).toEqual([{ targetDocumentId: 'edric', relationship: 'daughter of' }])
	})
})
