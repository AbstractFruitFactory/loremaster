import type { ConversationSource } from './ConversationFeed.svelte'

export type MessageSegment =
	{ type: 'text'; value: string } | { type: 'citation'; source: ConversationSource; number: number }

const citationPattern = /\[\[source:S(\d+)\]\]/g

export const parseMessageCitations = (
	content: string,
	sources: readonly ConversationSource[]
): MessageSegment[] => {
	const segments: MessageSegment[] = []
	const trailingMarker = content.match(/\[\[[^\]]*$/)
	const visibleContent = trailingMarker
		? content.slice(0, trailingMarker.index ?? content.length)
		: content
	let cursor = 0

	for (const match of visibleContent.matchAll(citationPattern)) {
		const index = match.index ?? 0
		const sourceNumber = Number(match[1])
		const source = sources[sourceNumber - 1]

		if (index > cursor) segments.push({ type: 'text', value: content.slice(cursor, index) })
		if (source) segments.push({ type: 'citation', source, number: sourceNumber })
		cursor = index + match[0].length
	}

	if (cursor < visibleContent.length) {
		segments.push({ type: 'text', value: visibleContent.slice(cursor) })
	}

	return segments
}

export const citedSourceNumbers = (
	content: string,
	sources: readonly ConversationSource[]
): Set<number> =>
	new Set(
		parseMessageCitations(content, sources)
			.filter((segment) => segment.type === 'citation')
			.map((segment) => segment.number)
	)
