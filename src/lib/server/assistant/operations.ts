import { flatMap, map, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiModel } from '../ai/provider'
import type { contextOperations } from '../context/operations'
import type { ContextConversationMessage, ContextItem } from '../context/types'
import { fail, type Failure } from '../failure'
import { assistantPrompt } from './prompt'
import type { AssistantResponse, LoreSource } from './types'

type AssistantDependencies = {
	ai: AiModel<'generateAssistant'>
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
	const chat = (
		campaignId: string,
		message: string,
		history: ContextConversationMessage[]
	): Effect<AssistantResponse, Failure> => {
		const request = message.trim()

		if (!request) {
			return fail('assistant', 'chat', { reason: 'emptyMessage' })
		}

		return pipe(
			context.buildAssistantContext({ campaignId, message: request, history }),
			flatMap((assistantContext) =>
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

	return { chat }
}
