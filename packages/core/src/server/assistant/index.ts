import { flatMap, map, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiModel } from '../ai/provider.js'
import type { context as createContext } from '../context/index.js'
import type { AssistantContext, ContextConversationMessage } from '../context/types.js'
import { fail, type Failure } from '../failure.js'
import { assistantPrompt } from './prompt.js'
import type { AssistantResponse, AssistantStream, LoreSource } from './types.js'

type AssistantDependencies = {
	ai: AiModel<'generateAssistant' | 'streamAssistant'>
	context: Pick<ReturnType<typeof createContext>, 'buildAssistantContext'>
}

const contextSources = ({ items, timeline }: AssistantContext) => {
	const sources = new Map<string, LoreSource>()

	for (const { fragment } of items) {
		sources.set(fragment.documentId, {
			id: fragment.documentId,
			title: fragment.title,
			type: fragment.documentType
		})
	}

	for (const event of timeline.events) {
		if (sources.has(event.documentId)) continue
		sources.set(event.documentId, {
			id: event.documentId,
			title: event.title,
			type: 'event'
		})
	}

	return [...sources.values()]
}

export const assistant = ({ ai, context }: AssistantDependencies) => {
	const requestContext = (
		campaignId: string,
		message: string,
		history: ContextConversationMessage[]
	) => {
		const request = message.trim()

		if (!request) {
			return fail('assistant', 'chat', { reason: 'emptyMessage' })
		}

		return context
			.buildAssistantContext({ campaignId, message: request, history })
			.pipe(map((assistantContext) => ({ assistantContext, request })))
	}

	const chat = (
		campaignId: string,
		message: string,
		history: ContextConversationMessage[]
	): Effect<AssistantResponse, Failure> => {
		return pipe(
			requestContext(campaignId, message, history),
			flatMap(({ assistantContext, request }) => {
				const sources = contextSources(assistantContext)

				return pipe(
					ai.generateAssistant({
						...assistantPrompt(request, history, assistantContext, sources),
						model: ai.model
					}),
					map(
						(response) =>
							({
								...response,
								sources
							}) satisfies AssistantResponse
					)
				)
			})
		)
	}

	const streamChat = (
		campaignId: string,
		message: string,
		history: ContextConversationMessage[],
		signal?: AbortSignal
	): Effect<AssistantStream, Failure> =>
		pipe(
			requestContext(campaignId, message, history),
			flatMap(({ assistantContext, request }) => {
				const sources = contextSources(assistantContext)

				return pipe(
					ai.streamAssistant({
						...assistantPrompt(request, history, assistantContext, sources),
						model: ai.model,
						signal
					}),
					map((events) => ({
						events,
						sources
					}))
				)
			})
		)

	return { chat, streamChat }
}
