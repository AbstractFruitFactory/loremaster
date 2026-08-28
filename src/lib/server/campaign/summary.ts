import type { GenerateTextInput } from '../ai/generate'
import type { Campaign } from './types'

export const campaignSummaryPrompt = (
	campaign: Pick<Campaign, 'name' | 'description'>
): GenerateTextInput => ({
	system: 'Summarize tabletop role-playing game campaigns for Dungeon Masters.',
	prompt: `Campaign "${campaign.name}": ${campaign.description}`
})
