import type {
	Response as OpenAiResponse,
	ResponseStreamEvent
} from 'openai/resources/responses/responses'
import { flip, runPromise } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { assistantEvents, createOpenAiProvider, parseAssistantResponse } from './openai'

describe('OpenAI provider', () => {
	it('parses assistant text and a lore proposal', () => {
		const response = {
			output_text: 'I drafted the drowned bell.',
			output: [
				{
					type: 'function_call',
					name: 'propose_lore',
					arguments: JSON.stringify({
						title: 'The Drowned Bell',
						category: 'item',
						content: 'The bell sounds beneath black water.'
					})
				}
			]
		} as OpenAiResponse

		expect(parseAssistantResponse(response)).toEqual({
			message: 'I drafted the drowned bell.',
			proposal: {
				title: 'The Drowned Bell',
				category: 'item',
				content: 'The bell sounds beneath black water.'
			}
		})
	})

	it('converts OpenAI stream events into assistant events', async () => {
		const source = (async function* () {
			yield {
				type: 'response.output_text.delta',
				delta: 'The bell ',
				content_index: 0,
				item_id: 'message-1',
				logprobs: [],
				output_index: 0,
				sequence_number: 1
			} satisfies ResponseStreamEvent
			yield {
				type: 'response.output_text.delta',
				delta: 'rings.',
				content_index: 0,
				item_id: 'message-1',
				logprobs: [],
				output_index: 0,
				sequence_number: 2
			} satisfies ResponseStreamEvent
			yield {
				type: 'response.function_call_arguments.done',
				arguments: JSON.stringify({
					title: 'The Drowned Bell',
					category: 'item',
					content: 'The bell sounds beneath black water.'
				}),
				item_id: 'tool-1',
				name: 'propose_lore',
				output_index: 1,
				sequence_number: 3
			} satisfies ResponseStreamEvent
		})()

		const events = []
		for await (const event of assistantEvents(source)) {
			events.push(event)
		}

		expect(events).toEqual([
			{ type: 'text-delta', delta: 'The bell ' },
			{ type: 'text-delta', delta: 'rings.' },
			{
				type: 'proposal',
				proposal: {
					title: 'The Drowned Bell',
					category: 'item',
					content: 'The bell sounds beneath black water.'
				}
			}
		])
	})

	it('rejects invalid proposal categories', () => {
		const response = {
			output_text: 'I drafted something.',
			output: [
				{
					type: 'function_call',
					name: 'propose_lore',
					arguments: JSON.stringify({
						title: 'Invalid',
						category: 'monster',
						content: 'Invalid category.'
					})
				}
			]
		} as OpenAiResponse

		expect(() => parseAssistantResponse(response)).toThrow()
	})

	it('reports a missing API key without constructing a client', async () => {
		const provider = createOpenAiProvider()
		const result = await runPromise(
			flip(provider.embedTexts({ model: 'text-embedding-3-small', values: ['Greyhaven'] }))
		)

		expect(result).toEqual({
			domain: 'ai',
			operation: 'embedTexts',
			cause: { reason: 'missingOpenAiApiKey' }
		})
	})
})
