import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { GenerateText } from '../ai/provider'
import type * as CampaignDb from '../db/campaign'
import { campaignOperations } from './operations'
import type { Campaign } from './types'

const campaign: Campaign = {
	id: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
	name: 'Curse of Blackwood',
	description: 'A gothic campaign.',
	createdAt: '2026-08-28T00:00:00.000Z'
}
const summaryModel = 'mock-text-v1'

describe('campaign operations', () => {
	it('uses the configured model to generate a campaign summary', async () => {
		const generateText = vi.fn(() => succeed('A gothic campaign summary.')) as GenerateText
		const db = {
			create: vi.fn(),
			getById: vi.fn(() => succeed(campaign)),
			list: vi.fn()
		} as typeof CampaignDb
		const operations = campaignOperations({
			ai: { generateText, model: summaryModel },
			db
		})

		const result = await runPromise(operations.generateCampaignSummary(campaign.id))

		expect(generateText).toHaveBeenCalledWith({
			model: summaryModel,
			system: 'Summarize tabletop role-playing game campaigns for Dungeon Masters.',
			prompt: 'Campaign "Curse of Blackwood": A gothic campaign.'
		})
		expect(result).toEqual({
			campaignId: campaign.id,
			content: 'A gothic campaign summary.'
		})
	})
})
