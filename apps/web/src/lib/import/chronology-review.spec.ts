import { describe, expect, it } from 'vitest'
import type { CampaignImportChronologyProposal } from '#lib/server/ingestion/types.js'
import {
	campaignImportChronologyCommitUiState,
	groupCampaignImportChronology,
	initialCampaignImportChronologySelections,
	selectedCampaignImportChronologyIds
} from './chronology-review.js'

const relationship = (
	chronologyId: string,
	sourceId: string,
	selected: boolean
): CampaignImportChronologyProposal => ({
	chronologyId,
	relation: 'before',
	source: { eventId: sourceId, title: `Event ${sourceId}`, source: 'existing' },
	target: { eventId: `${chronologyId}-target`, title: 'Target', source: 'existing' },
	certainty: selected ? 'explicit' : 'inferred',
	reason: 'Evidence establishes this relationship.',
	selected,
	supportingClaimIds: [],
	evidence: []
})

describe('campaign import chronology review', () => {
	it('groups relationships by the affected event', () => {
		const relationships = [
			relationship('first', 'event-a', true),
			relationship('second', 'event-a', false),
			relationship('third', 'event-b', true)
		]

		expect(
			groupCampaignImportChronology(relationships).map((group) => ({
				eventId: group.affected.eventId,
				chronologyIds: group.relationships.map(({ chronologyId }) => chronologyId)
			}))
		).toEqual([
			{ eventId: 'event-a', chronologyIds: ['first', 'second'] },
			{ eventId: 'event-b', chronologyIds: ['third'] }
		])
	})

	it('uses safe persisted defaults and returns only approved relationship IDs', () => {
		const relationships = [
			relationship('explicit', 'event-a', true),
			relationship('inferred', 'event-b', false)
		]
		const selections = initialCampaignImportChronologySelections(relationships)

		expect(selections).toEqual({ explicit: true, inferred: false })
		expect(selectedCampaignImportChronologyIds(relationships, selections)).toEqual(['explicit'])
	})

	it('treats persisted chronology commit data as started before the workflow row appears', () => {
		expect(
			campaignImportChronologyCommitUiState({
				phase: 'chronology-committing',
				lifecycle: 'not-started',
				retryable: true
			})
		).toEqual({
			started: true,
			retryable: true,
			active: false
		})
	})

	it.each(['not-started', 'failed', 'cancelled'] as const)(
		'offers retry for retryable %s chronology commits after commit starts',
		(lifecycle) => {
			expect(
				campaignImportChronologyCommitUiState({
					phase: 'chronology-committing',
					lifecycle,
					retryable: true
				})
			).toMatchObject({ started: true, retryable: true, active: false })
		}
	)

	it.each(['queued', 'running'] as const)(
		'shows progress for %s chronology commits',
		(lifecycle) => {
			expect(
				campaignImportChronologyCommitUiState({
					phase: 'chronology-committing',
					lifecycle,
					retryable: false
				})
			).toMatchObject({ started: true, retryable: false, active: true })
		}
	)
})
