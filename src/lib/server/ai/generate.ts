import { succeed } from 'effect/Effect'
import type { Effect } from 'effect/Effect'
import type { Failure } from '../failure'

export type GenerateText = (input: {
	system?: string
	prompt: string
}) => Effect<string, Failure<'ai', 'generateText'>>

export const generateText: GenerateText = ({ system, prompt }) => {
	const titles = [...prompt.matchAll(/^## Lore: (.+)$/gm)].map((match) => match[1])
	const context = titles.length ? titles.join(', ') : 'the available campaign lore'

	return succeed(
		system?.startsWith('Draft')
			? `A new piece of lore shaped by ${context}. It introduces a useful detail the party can discover and gives the Dungeon Master a clear thread to develop.`
			: `Based on ${context}, the campaign lore points to a connection the Dungeon Master can use at the table.`
	)
}
