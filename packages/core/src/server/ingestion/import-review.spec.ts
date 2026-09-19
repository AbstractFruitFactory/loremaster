import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
	campaignImportReview,
	initialCampaignImportReviewState,
	validateCampaignImportReviewUpdate
} from './import-review.js'
import type { CampaignImportDraft, SessionProposal } from './types.js'

const proposal = (
	proposalId: string,
	overrides: Partial<SessionProposal> = {}
): SessionProposal => ({
	proposalId,
	claimIds: [`claim-${proposalId}`],
	operation: 'create-entity',
	documentType: 'npc',
	title: proposalId,
	certainty: 'explicit',
	selected: true,
	evidence: [],
	match: { kind: 'unresolved', candidates: [] },
	references: [],
	content: proposalId,
	canCreate: true,
	resolutionMethod: 'deterministic',
	...overrides
})

const draft = (proposals: SessionProposal[]): CampaignImportDraft => ({
	schemaVersion: 1,
	kind: 'campaign-import',
	campaignId: 'campaign',
	ingestionId: 'ingestion',
	createdAt: '2026-09-19T08:00:00.000Z',
	sources: [],
	claims: [],
	temporalClaims: [],
	proposals,
	warnings: []
})

describe('campaign import review state', () => {
	it('initializes only deterministic explicit proposals as selected', () => {
		const deterministic = proposal('deterministic')
		const inferred = proposal('inferred', { certainty: 'inferred' })
		const modelResolved = proposal('model', { resolutionMethod: 'model' })
		const ambiguous = proposal('ambiguous', {
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: 'existing',
						revisionId: 'revision',
						title: 'Existing',
						documentType: 'npc',
						score: 4
					}
				]
			}
		})

		const state = initialCampaignImportReviewState(
			draft([deterministic, inferred, modelResolved, ambiguous])
		)

		expect(state.selectedProposalIds).toEqual([deterministic.proposalId])
		expect(state.resolutions).toEqual([{ proposalId: ambiguous.proposalId, kind: 'create' }])
		expect(state.revision).toBe(0)
		expect(state.updatedAt).toBe('2026-09-19T08:00:00.000Z')
	})

	it('rejects selected unresolved identities until they have a valid resolution', async () => {
		const ambiguous = proposal('ambiguous', {
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: 'existing',
						revisionId: 'revision',
						title: 'Existing',
						documentType: 'npc',
						score: 4
					}
				]
			}
		})
		const value = draft([ambiguous])

		expect(
			await runPromise(
				flip(
					validateCampaignImportReviewUpdate(value, {
						campaignId: value.campaignId,
						ingestionId: value.ingestionId,
						expectedRevision: 0,
						selectedProposalIds: [ambiguous.proposalId],
						resolutions: []
					})
				)
			)
		).toMatchObject({ cause: { reason: 'unresolvedMatch', proposalId: ambiguous.proposalId } })

		await expect(
			runPromise(
				validateCampaignImportReviewUpdate(value, {
					campaignId: value.campaignId,
					ingestionId: value.ingestionId,
					expectedRevision: 0,
					selectedProposalIds: [ambiguous.proposalId],
					resolutions: [
						{
							proposalId: ambiguous.proposalId,
							kind: 'existing',
							documentId: 'existing'
						}
					]
				})
			)
		).resolves.toBeUndefined()
	})

	it('rejects unknown proposal IDs and invalid identity targets', async () => {
		const ambiguous = proposal('ambiguous', {
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: 'wrong-type',
						revisionId: 'revision',
						title: 'Wrong type',
						documentType: 'location',
						score: 4
					}
				]
			}
		})
		const value = draft([ambiguous])
		const invalidUpdates = [
			{
				selectedProposalIds: ['unknown'],
				resolutions: []
			},
			{
				selectedProposalIds: [],
				resolutions: [
					{ proposalId: ambiguous.proposalId, kind: 'existing' as const, documentId: 'missing' }
				]
			},
			{
				selectedProposalIds: [],
				resolutions: [
					{
						proposalId: ambiguous.proposalId,
						kind: 'existing' as const,
						documentId: 'wrong-type'
					}
				]
			}
		]

		for (const update of invalidUpdates) {
			const failure = await runPromise(
				flip(
					validateCampaignImportReviewUpdate(value, {
						campaignId: value.campaignId,
						ingestionId: value.ingestionId,
						expectedRevision: 0,
						...update
					})
				)
			)
			expect(failure).toMatchObject({
				domain: 'ingestion',
				operation: 'saveCampaignImportReviewState'
			})
		}
	})

	it('rejects create resolutions for non-creatable conflicts', async () => {
		const ambiguous = proposal('ambiguous', {
			canCreate: false,
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: 'existing',
						revisionId: 'revision',
						title: 'Existing',
						documentType: 'npc',
						score: 4
					}
				]
			}
		})
		const value = draft([ambiguous])

		const failure = await runPromise(
			flip(
				validateCampaignImportReviewUpdate(value, {
					campaignId: value.campaignId,
					ingestionId: value.ingestionId,
					expectedRevision: 0,
					selectedProposalIds: [],
					resolutions: [{ proposalId: ambiguous.proposalId, kind: 'create' }]
				})
			)
		)
		expect(failure).toMatchObject({
			cause: {
				proposalId: ambiguous.proposalId
			}
		})
	})

	it('increments the expected revision when saving through the core operation', async () => {
		const value = draft([proposal('selected')])
		let state = initialCampaignImportReviewState(value)
		const storage: Parameters<typeof campaignImportReview>[0]['storage'] = {
			initializeCampaignImportReviewState: () => succeed(undefined),
			readCampaignImportReviewState: () => succeed(state),
			updateCampaignImportReviewState: (next, expectedRevision) => {
				expect(expectedRevision).toBe(0)
				expect(next.revision).toBe(1)
				state = next
				return succeed(next)
			}
		}
		const operations = campaignImportReview({
			storage,
			now: () => '2026-09-19T10:00:00.000Z'
		})

		const saved = await runPromise(
			operations.saveState(value, {
				campaignId: value.campaignId,
				ingestionId: value.ingestionId,
				expectedRevision: 0,
				selectedProposalIds: ['selected'],
				resolutions: []
			})
		)

		expect(saved).toMatchObject({
			revision: 1,
			updatedAt: '2026-09-19T10:00:00.000Z',
			selectedProposalIds: ['selected']
		})
		expect(await runPromise(operations.getState(value.campaignId, value.ingestionId))).toEqual(
			saved
		)
	})
})
