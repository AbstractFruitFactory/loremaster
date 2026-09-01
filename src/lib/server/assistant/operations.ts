import { flatMap, map, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiModel } from '../ai/provider'
import type { contextOperations } from '../context/operations'
import type { ContextConversationMessage, ContextItem } from '../context/types'
import { fail, type Failure } from '../failure'
import { assistantPrompt } from './prompt'
import type { AssistantResponse, AssistantStream, LoreSource } from './types'

type AssistantDependencies = {
	ai: AiModel<'generateAssistant' | 'streamAssistant'>
	context: Pick<ReturnType<typeof contextOperations>, 'buildAssistantContext'>
}

const contextSources = (items: ContextItem[]) => {
	const sources = new Map<string, LoreSource>()

	for (const { fragment } of items) {
		sources.set(fragment.documentId, {
			id: fragment.documentId,
			title: fragment.title,
			type: fragment.documentType
		})
	}

	return [...sources.values()]
}

export const assistantOperations = ({ ai, context }: AssistantDependencies) => {
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
			flatMap(({ assistantContext, request }) =>
				pipe(
					ai.generateAssistant({
						...assistantPrompt(request, history, assistantContext),
						model: ai.model
					}),
					map(
						(response) =>
							({
								...response,
								sources: contextSources(assistantContext.items)
							}) satisfies AssistantResponse
					)
				)
			)
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
			flatMap(({ assistantContext, request }) =>
				pipe(
					ai.streamAssistant({
						...assistantPrompt(request, history, assistantContext),
						model: ai.model,
						signal
					}),
					map((events) => ({
						events,
						sources: contextSources(assistantContext.items)
					}))
				)
			)
		)

	return { chat, streamChat }
}
