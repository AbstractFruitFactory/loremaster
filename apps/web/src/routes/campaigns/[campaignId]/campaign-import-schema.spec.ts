import { describe, expect, it } from 'vitest'
import {
	commitCampaignImportInput,
	saveCampaignImportReviewStateInput,
	startCampaignImportInput
} from './campaign-import-schema.js'

const campaignId = '40000000-0000-4000-8000-000000000001'
const ingestionId = '30000000-0000-4000-8000-000000000001'

describe('campaign import remote schemas', () => {
	it('accepts display metadata without turning names into identity', () => {
		const result = startCampaignImportInput.parse({
			campaignId,
			ingestionId,
			sources: [
				{
					displayName: ' ./LORE\\Mara.MD ',
					title: 'Mara notes',
					mediaType: 'text/markdown',
					content: '# Notes\n\nUnstructured campaign notes.'
				}
			]
		})
		expect(result.ingestionId).toBe(ingestionId)
		expect(result.sources[0]).toMatchObject({ displayName: './LORE\\Mara.MD' })
		expect(result.sources[0]).not.toHaveProperty('directImport')
		expect(result.sources[0]).not.toHaveProperty('sourceId')
		expect(result).not.toHaveProperty('title')
		expect(
			startCampaignImportInput.safeParse({ ...result, title: 'Legacy batch title' }).success
		).toBe(false)
	})

	it('rejects identity metadata while allowing same-named sources', () => {
		expect(
			startCampaignImportInput.safeParse({
				campaignId,
				sources: [
					{
						displayName: 'mara.md',
						title: 'Mara',
						mediaType: 'text/markdown',
						content: '# Mara',
						sourceId: '10000000-0000-5000-8000-000000000001'
					}
				]
			}).success
		).toBe(false)
		expect(
			startCampaignImportInput.safeParse({
				campaignId,
				sources: [
					{
						displayName: 'same.md',
						title: 'Mara',
						mediaType: 'text/markdown',
						content: '# Mara'
					},
					{
						displayName: 'same.md',
						title: 'Mara duplicate',
						mediaType: 'text/markdown',
						content: '# Mara'
					}
				]
			}).success
		).toBe(true)
		expect(
			startCampaignImportInput.safeParse({
				campaignId,
				sources: [
					{
						sourceKey: 'legacy.md',
						displayName: 'mara.md',
						title: 'Mara',
						mediaType: 'text/markdown',
						content: '# Mara'
					}
				]
			}).success
		).toBe(false)
	})

	it('enforces extensions and byte limits while allowing empty commit selections', () => {
		expect(
			startCampaignImportInput.safeParse({
				campaignId,
				sources: [
					{
						displayName: 'mara.pdf',
						title: 'Mara',
						mediaType: 'text/plain',
						content: 'Mara'
					}
				]
			}).success
		).toBe(false)
		expect(
			startCampaignImportInput.safeParse({
				campaignId,
				sources: [
					{
						displayName: 'large.txt',
						title: 'Large',
						mediaType: 'text/plain',
						content: 'é'.repeat(1024 * 1024 + 1)
					}
				]
			}).success
		).toBe(false)
		expect(
			commitCampaignImportInput.safeParse({
				campaignId,
				ingestionId,
				expectedReviewRevision: 3,
				selectedProposalIds: [],
				resolutions: []
			}).success
		).toBe(true)
		expect(
			commitCampaignImportInput.safeParse({
				campaignId,
				ingestionId,
				selectedProposalIds: [],
				resolutions: []
			}).success
		).toBe(false)
	})

	it('rejects unsupported resolutions and oversized commit selections', () => {
		const proposalIds = Array.from(
			{ length: 501 },
			(_, index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`
		)
		expect(
			commitCampaignImportInput.safeParse({
				campaignId,
				ingestionId,
				expectedReviewRevision: 3,
				selectedProposalIds: [],
				resolutions: [{ proposalId: proposalIds[0], kind: ['decide', 'later'].join('-') }]
			}).success
		).toBe(false)

		const oversized = commitCampaignImportInput.safeParse({
			campaignId,
			ingestionId,
			expectedReviewRevision: 3,
			selectedProposalIds: proposalIds,
			resolutions: []
		})
		expect(oversized.success).toBe(false)
		if (!oversized.success) {
			expect(oversized.error.issues[0]?.message).toBe(
				'At most 500 proposals can be committed at once'
			)
		}

		expect(
			saveCampaignImportReviewStateInput.safeParse({
				campaignId,
				ingestionId,
				expectedRevision: 3,
				selectedProposalIds: proposalIds,
				resolutions: []
			}).success
		).toBe(true)
	})
})
