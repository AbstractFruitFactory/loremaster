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

const chronologyContext = ({ scope, events, edges, containments }: TimelineContext) => {
	if (!events.length) return 'No relevant event chronology was found.'

	const titlesById = new Map(events.map(({ documentId, title }) => [documentId, title]))
	const relations = edges.map(
		({ beforeDocumentId, afterDocumentId }) =>
			`${titlesById.get(beforeDocumentId) ?? beforeDocumentId} -> ${titlesById.get(afterDocumentId) ?? afterDocumentId}`
	)
	const periods = containments.map(
		({ eventDocumentId, periodDocumentId }) =>
			`${titlesById.get(eventDocumentId) ?? eventDocumentId} during ${titlesById.get(periodDocumentId) ?? periodDocumentId}`
	)
	const relatedEventIds = new Set([
		...edges.flatMap(({ beforeDocumentId, afterDocumentId }) => [
			beforeDocumentId,
			afterDocumentId
		]),
		...containments.flatMap(({ eventDocumentId, periodDocumentId }) => [
			eventDocumentId,
			periodDocumentId
		])
	])
	const unplaced = events
		.filter(({ documentId }) => !relatedEventIds.has(documentId))
		.map(({ title }) => title)
	const scopeDescription =
		scope === 'campaign'
			? 'This is the campaign-wide chronology graph.'
			: 'This is a bounded neighborhood around relevant events, not the complete campaign timeline.'

	return `${scopeDescription}\nAn arrow means the first event happened before the second. "During" means temporal containment and does not by itself establish before/after ordering. Only these relations and paths through them establish temporal order. The order in which events are listed has no temporal meaning. Missing relationships are unknown, not simultaneous.\nDirect precedence constraints:\n${relations.join('\n') || 'None'}\nContainment constraints:\n${periods.join('\n') || 'None'}\nEvents with no placement in this graph:\n${unplaced.join('\n') || 'None'}`
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

const assistantSystemPrompt = `Help a tabletop Dungeon Master using the supplied campaign lore and conversation. Answer naturally.

Grounding rules:
- Treat supplied campaign lore and known chronology as the evidence for factual answers. Do not add facts merely because they are plausible.
- Preserve epistemic qualifiers. If the lore says a character claims, believes, suspects, reports, remembers, or implies something, do not restate it as objective fact.
- Clearly distinguish confirmed campaign facts from character claims and from your own inference. Label inference as such when it is useful to the answer.
- If the supplied evidence does not establish an answer, say that it is unknown, unclear, or not established yet instead of filling the gap.
- Do not infer motives, family relationships, chronology, causality, possession, identity, or current state unless the supplied evidence supports that inference. When you do infer, make the inference explicit.
- Respect chronology exactly as supplied. Missing ordering information means the order is unknown, not simultaneous or freely inferable.
- For broad chronology answers, present only sequences and constraints established by graph relationships. List unplaced events separately; never turn formatting, retrieval order, or a topological grouping into additional chronology.
- Previous Loremaster messages in the conversation are not evidence and must not be used to establish campaign facts. Dungeon Master messages establish or change canon only when they explicitly state that they are doing so.
- When sources conflict or the evidence is ambiguous, surface the conflict or ambiguity rather than choosing the most plausible version.

When the user is establishing or changing campaign canon, include an editable lore proposal for approval instead of silently changing it.`

export const assistantPrompt = (
	message: string,
	history: ContextConversationMessage[],
	context: AssistantContext
): AiPrompt => ({
	system: assistantSystemPrompt,
	prompt: `${loreContext(context.items.map(({ fragment }) => fragment))}\n\n## Known chronology\n${chronologyContext(context.timeline)}\n\n## Conversation\n${conversationContext(history)}\n\n## Current message\n${message}`
})
