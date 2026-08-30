import { succeed } from 'effect/Effect'
import type { DocumentType } from '../../../document'
import { EMBEDDING_DIMENSIONS } from '../provider'
import type {
	AiProvider,
	EmbedTexts,
	GenerateAssistant,
	GenerateText,
	InferDocumentType
} from '../provider'

const directoryTypes: Record<string, DocumentType> = {
	players: 'player',
	npcs: 'npc',
	locations: 'location',
	sessions: 'session',
	items: 'item',
	lore: 'lore',
	events: 'event'
}

const contentPatterns: [DocumentType, RegExp][] = [
	['player', /\b(player character|player|protagonist|hero)\b/i],
	['npc', /\b(non-player character|npc|blacksmith|merchant|villain)\b/i],
	['location', /\b(location|place|town|city|village|region|dungeon)\b/i],
	['session', /\b(session notes|session|recap)\b/i],
	['item', /\b(item|artifact|weapon|armor|relic)\b/i],
	['event', /\b(event|battle|festival|incident|war)\b/i]
]

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

const tokens = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

const tokenHash = (token: string) => {
	let hash = 2_166_136_261

	for (const character of token) {
		hash ^= character.codePointAt(0) ?? 0
		hash = Math.imul(hash, 16_777_619)
	}

	return hash >>> 0
}

const embedText = (text: string) => {
	const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0)

	for (const token of tokens(text)) {
		const hash = tokenHash(token)
		const index = hash % EMBEDDING_DIMENSIONS
		const direction = (hash >>> 6) & 1 ? 1 : -1
		vector[index] = (vector[index] ?? 0) + direction
	}

	const magnitude = Math.hypot(...vector)

	return magnitude ? vector.map((value) => value / magnitude) : vector
}

const generateText: GenerateText = ({ system, prompt }) => {
	const titles = [...prompt.matchAll(/^## Lore: (.+)$/gm)].map((match) => match[1])
	const context = titles.length ? titles.join(', ') : 'the available campaign lore'

	return succeed(
		system?.startsWith('Draft')
			? `A new piece of lore shaped by ${context}. It introduces a useful detail the party can discover and gives the Dungeon Master a clear thread to develop.`
			: `Based on ${context}, the campaign lore points to a connection the Dungeon Master can use at the table.`
	)
}

const generateAssistant: GenerateAssistant = ({ prompt }) => {
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

const embedTexts: EmbedTexts = ({ values }) => succeed(values.map(embedText))

const inferDocumentType: InferDocumentType = ({ path, title, content }) => {
	const directory = path.split('/', 1)[0]?.toLocaleLowerCase()
	const directoryType = directory ? directoryTypes[directory] : undefined

	if (directoryType) return succeed(directoryType)

	const source = `${title}\n${content}`
	return succeed(contentPatterns.find(([, pattern]) => pattern.test(source))?.[0] ?? 'lore')
}

export const mockAiProvider: AiProvider = {
	embedTexts,
	generateAssistant,
	generateText,
	inferDocumentType
}
