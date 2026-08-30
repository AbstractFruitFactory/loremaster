import type { GenerateText } from '../ai/generate'
import type { ContextConversationMessage, ContextFragment } from '../context/types'

const loreContext = (fragments: ContextFragment[]) =>
	fragments.length
		? fragments
				.map(
					(fragment) =>
						`## Lore: ${fragment.title}\n${fragment.documentType ? `Category: ${fragment.documentType}\n` : ''}${fragment.heading ? `Section: ${fragment.heading}\n` : ''}${fragment.content}`
				)
				.join('\n\n')
		: 'No relevant campaign lore was found.'

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
	fragments: ContextFragment[]
): Parameters<GenerateText>[0] => ({
	system:
		'Help a tabletop Dungeon Master using the supplied campaign lore and conversation. Answer naturally. When the user is establishing or changing campaign canon, include an editable lore proposal for approval instead of silently changing it.',
	prompt: `${loreContext(fragments)}\n\n## Conversation\n${conversationContext(history)}\n\n## Current message\n${message}`
})
