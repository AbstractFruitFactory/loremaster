import { succeed } from 'effect/Effect'
import type { DocumentType } from '../../document'
import type { GenerateAssistant } from '../assistant/types'

const proposalRequest = /\b(add|create|establish|introduce|invent|make|record|remember|update)\b/i

const categoryFor = (message: string): DocumentType => {
	if (/\b(player|player character|hero)\b/i.test(message)) return 'player'
	if (/\b(character|person|npc|blacksmith|merchant|villain)\b/i.test(message)) return 'npc'
	if (/\b(place|location|town|city|village|region|dungeon)\b/i.test(message)) return 'location'
	if (/\b(session|recap|session notes)\b/i.test(message)) return 'session'
	if (/\b(event|battle|festival|incident|war)\b/i.test(message)) return 'event'
	if (/\b(item|artifact|weapon|armor|relic)\b/i.test(message)) return 'item'
	return 'lore'
}

const currentMessage = (prompt: string) => prompt.split('## Current message\n').at(-1)?.trim() ?? ''

export const generateAssistant: GenerateAssistant = ({ prompt }) => {
	const message = currentMessage(prompt)

	if (!proposalRequest.test(message)) {
		return succeed({
			message:
				'Based on the available campaign lore, there is a connection the Dungeon Master can develop at the table.'
		})
	}

	const category = categoryFor(message)

	return succeed({
		message:
			'I drafted a lore suggestion from that idea. Review it before adding it to the campaign.',
		proposal: {
			title: `New ${category}`,
			category,
			content: `A campaign detail inspired by this direction: ${message}`
		}
	})
}
