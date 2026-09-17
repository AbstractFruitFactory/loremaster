import type { AiPrompt } from '../ai/provider'
import type { Campaign } from './types'

export const campaignSummaryPrompt = (
	campaign: Pick<Campaign, 'name' | 'description'>
): AiPrompt => ({
	system: 'Summarize tabletop role-playing game campaigns for Dungeon Masters.',
	prompt: `Campaign "${campaign.name}": ${campaign.description}`
})
