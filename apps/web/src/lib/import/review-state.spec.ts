import { describe, expect, it } from 'vitest'
import type { SessionProposal } from '#lib/server/ingestion/types.js'
import {
	buildCampaignImportCommitSelection,
	canSelectProposal,
	createInitialReviewState,
	excerptPreview,
	proposalMatchesFilters,
	reviewChoicesFromServerState,
	strongestEvidenceFirst
} from './review-state.js'

const proposal = (
	proposalId: string,
	overrides: Partial<SessionProposal> = {}
): SessionProposal => ({
	proposalId,
	claimIds: [`claim-${proposalId}`],
	operation: 'create-entity',
	documentType: 'npc',
	title: `Proposal ${proposalId}`,
	certainty: 'explicit',
	selected: true,
	evidence: [],
	match: { kind: 'unresolved', candidates: [] },
	references: [],
	content: `Content ${proposalId}`,
	canCreate: true,
	...overrides
})

describe('campaign import review state', () => {
	it('records a safe create resolution without selecting an unresolved identity', () => {
		const ambiguous = proposal('ambiguous', {
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: 'existing',
						revisionId: 'revision',
						title: 'Existing NPC',
						documentType: 'npc',
						score: 4
					}
				]
			}
		})

		const state = createInitialReviewState([ambiguous])

		expect(state.selected[ambiguous.proposalId]).toBe(false)
		expect(state.resolutions[ambiguous.proposalId]).toEqual({ kind: 'create' })
	})

	it('keeps inferred create-capable proposals unselected', () => {
		const inferred = proposal('inferred', {
			certainty: 'inferred',
			match: {
				kind: 'unresolved',
				candidates: []
			}
		})
		const state = createInitialReviewState([inferred])

		expect(buildCampaignImportCommitSelection([inferred], state)).toEqual({
			selectedProposalIds: [],
			resolutions: []
		})
	})

	it('loads selections and resolutions from persisted server state', () => {
		const first = proposal('first')
		const second = proposal('second', {
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: 'existing',
						revisionId: 'revision',
						title: 'Existing NPC',
						documentType: 'npc',
						score: 4
					}
				]
			}
		})

		expect(
			reviewChoicesFromServerState([first, second], {
				schemaVersion: 1,
				campaignId: 'campaign',
				ingestionId: 'ingestion',
				revision: 3,
				updatedAt: '2026-09-19T10:00:00.000Z',
				selectedProposalIds: [second.proposalId],
				resolutions: [{ proposalId: second.proposalId, kind: 'existing', documentId: 'existing' }]
			})
		).toEqual({
			selected: { first: false, second: true },
			resolutions: { second: { kind: 'existing', documentId: 'existing' } }
		})
	})

	it('requires a valid identity resolution before selection', () => {
		const ambiguous = proposal('ambiguous', {
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: 'existing',
						revisionId: 'revision',
						title: 'Existing NPC',
						documentType: 'npc',
						score: 4
					}
				]
			}
		})

		expect(canSelectProposal(ambiguous, undefined)).toBe(false)
		expect(canSelectProposal(ambiguous, { kind: 'existing', documentId: 'missing' })).toBe(false)
		expect(canSelectProposal(ambiguous, { kind: 'existing', documentId: 'existing' })).toBe(true)
		expect(canSelectProposal(ambiguous, { kind: 'create' })).toBe(true)
	})

	it('commits resolutions only for selected proposals', () => {
		const selected = proposal('selected')
		const rejected = proposal('rejected')

		expect(
			buildCampaignImportCommitSelection([selected, rejected], {
				selected: { selected: true, rejected: false },
				resolutions: {
					selected: { kind: 'create' },
					rejected: { kind: 'create' }
				}
			})
		).toEqual({
			selectedProposalIds: ['selected'],
			resolutions: [{ proposalId: 'selected', kind: 'create' }]
		})
	})

	it('filters proposals by source and review status', () => {
		const sourced = proposal('sourced', {
			evidence: [
				{
					sourceId: 'source-a',
					sourceRevisionId: 'revision-a',
					excerpt: 'Evidence',
					chunkId: 'chunk',
					startStringIndex: 0,
					endStringIndex: 8,
					startLine: 1,
					endLine: 1
				}
			]
		})

		expect(proposalMatchesFilters(sourced, true, { kind: 'create' }, 'source-a', 'selected')).toBe(
			true
		)
		expect(proposalMatchesFilters(sourced, true, { kind: 'create' }, 'source-b', 'selected')).toBe(
			false
		)
		expect(proposalMatchesFilters(sourced, false, undefined, 'source-a', 'not-selected')).toBe(true)
	})

	it('puts the longest evidence excerpt first', () => {
		const short = {
			excerpt: 'Short',
			chunkId: 'short',
			startStringIndex: 0,
			endStringIndex: 5,
			startLine: 1,
			endLine: 1
		}
		const strong = {
			excerpt: 'A longer and more useful excerpt',
			chunkId: 'strong',
			startStringIndex: 10,
			endStringIndex: 42,
			startLine: 2,
			endLine: 2
		}

		expect(strongestEvidenceFirst([short, strong])).toEqual([strong, short])
	})

	it('truncates long evidence without losing access to the original excerpt', () => {
		const excerpt = 'Alpha beta gamma delta'

		expect(excerptPreview(excerpt, 12)).toEqual({
			content: 'Alpha beta…',
			truncated: true
		})
		expect(excerptPreview('Short excerpt', 20)).toEqual({
			content: 'Short excerpt',
			truncated: false
		})
		expect(excerpt).toBe('Alpha beta gamma delta')
	})
})
