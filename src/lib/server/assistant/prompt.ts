import type { AiPrompt } from '../ai/provider'
import type {
	AssistantContext,
	ContextConversationMessage,
	ContextFragment
} from '../context/types'
import type { TimelineContext } from '../timeline/types'

const loreContext = (fragments: ContextFragment[]) =>
	fragments.length
		? fragments
				.map(
					(fragment) =>
						`## Lore: ${fragment.title}\n${fragment.documentType ? `Category: ${fragment.documentType}\n` : ''}${fragment.heading ? `Section: ${fragment.heading}\n` : ''}${fragment.content}`
				)
				.join('\n\n')
		: 'No relevant campaign lore was found.'

const chronologyContext = ({ events, edges, layers }: TimelineContext) => {
	if (!events.length) return 'No relevant event chronology was found.'

	const titlesById = new Map(events.map(({ documentId, title }) => [documentId, title]))
	const relations = edges.map(
		({ beforeDocumentId, afterDocumentId }) =>
			`${titlesById.get(beforeDocumentId) ?? beforeDocumentId} -> ${titlesById.get(afterDocumentId) ?? afterDocumentId}`
	)
	const orderedLayers = layers.map((documentIds, index) => {
		const titles = documentIds.map((documentId) => titlesById.get(documentId) ?? documentId)
		const qualification = titles.length > 1 ? ' (no known order within this group)' : ''
		return `${index + 1}. ${titles.join(', ')}${qualification}`
	})

	return `An arrow means the first event happened before the second. Missing relationships are unknown, not simultaneous.\nDirect constraints:\n${relations.join('\n') || 'None'}\nKnown ordering layers:\n${orderedLayers.join('\n')}`
}

const conversationContext = (history: ContextConversationMessage[]) =>
	history.length
		? history
				.slice(-12)
				.map(
					({ role, content }) =>
						`${role === 'user' ? 'Dungeon Master' : 'Loremaster'}: ${content.slice(0, 2_000)}`
				)
				.join('\n')
		: 'No previous conversation.'

export const assistantPrompt = (
	message: string,
	history: ContextConversationMessage[],
	context: AssistantContext
): AiPrompt => ({
	system:
		'Help a tabletop Dungeon Master using the supplied campaign lore and conversation. Answer naturally. When the user is establishing or changing campaign canon, include an editable lore proposal for approval instead of silently changing it.',
	prompt: `${loreContext(context.items.map(({ fragment }) => fragment))}\n\n## Known chronology\n${chronologyContext(context.timeline)}\n\n## Conversation\n${conversationContext(history)}\n\n## Current message\n${message}`
})
