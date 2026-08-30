import { succeed, type Effect } from 'effect/Effect'
import type { DocumentType } from '../../document'
import type { Failure } from '../failure'

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

export const inferDocumentType = ({
	path,
	title,
	content
}: {
	path: string
	title: string
	content: string
}): Effect<DocumentType, Failure<'ai', 'inferDocumentType'>> => {
	const directory = path.split('/', 1)[0]?.toLocaleLowerCase()
	const directoryType = directory ? directoryTypes[directory] : undefined

	if (directoryType) return succeed(directoryType)

	const source = `${title}\n${content}`
	return succeed(contentPatterns.find(([, pattern]) => pattern.test(source))?.[0] ?? 'lore')
}
