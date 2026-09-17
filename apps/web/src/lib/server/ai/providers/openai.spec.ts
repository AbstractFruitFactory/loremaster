import type {
	Response as OpenAiResponse,
	ResponseStreamEvent
} from 'openai/resources/responses/responses'
import { flip, runPromise } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
	assistantEvents,
	createOpenAiProvider,
	openAiProvider,
	parseAssistantResponse
} from './openai'

describe('OpenAI provider', () => {
	it('parses assistant text and a lore proposal', () => {
		const response = {
			output_text: 'I drafted the drowned bell.',
			output: [
				{
					type: 'function_call',
					name: 'propose_new_lore',
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
				name: 'propose_new_lore',
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

	it('recovers a proposal from a completed output item', async () => {
		const source = (async function* () {
			yield {
				type: 'response.output_item.done',
				item: {
					id: 'tool-1',
					type: 'function_call',
					call_id: 'call-1',
					name: 'propose_new_lore',
					arguments: JSON.stringify({
						title: 'Grog',
						category: 'npc',
						content: 'Grog is an orc barbarian.'
					}),
					status: 'completed'
				},
				output_index: 0,
				sequence_number: 1
			} satisfies ResponseStreamEvent
		})()

		const events = []
		for await (const event of assistantEvents(source)) {
			events.push(event)
		}

		expect(events).toEqual([
			{ type: 'text-delta', delta: 'I drafted a lore suggestion for your review.' },
			{
				type: 'proposal',
				proposal: {
					title: 'Grog',
					category: 'npc',
					content: 'Grog is an orc barbarian.'
				}
			}
		])
	})

	it('recovers a proposal from the completed response', async () => {
		const source = (async function* () {
			yield {
				type: 'response.completed',
				response: {
					output_text: '',
					output: [
						{
							type: 'function_call',
							name: 'propose_new_lore',
							arguments: JSON.stringify({
								title: 'Grog',
								category: 'npc',
								content: 'Grog is an orc barbarian.'
							})
						}
					]
				}
			} as ResponseStreamEvent
		})()

		const events = []
		for await (const event of assistantEvents(source)) {
			events.push(event)
		}

		expect(events).toEqual([
			{ type: 'text-delta', delta: 'I drafted a lore suggestion for your review.' },
			{
				type: 'proposal',
				proposal: {
					title: 'Grog',
					category: 'npc',
					content: 'Grog is an orc barbarian.'
				}
			}
		])
	})

	it('emits a visible fallback when a successful stream has no output', async () => {
		const source = (async function* (): AsyncGenerator<ResponseStreamEvent> {})()
		const events = []

		for await (const event of assistantEvents(source)) {
			events.push(event)
		}

		expect(events).toEqual([{ type: 'text-delta', delta: 'I could not generate a response.' }])
	})

	it.each(['session', 'monster'])('rejects the %s proposal category', (category) => {
		const response = {
			output_text: 'I drafted something.',
			output: [
				{
					type: 'function_call',
					name: 'propose_new_lore',
					arguments: JSON.stringify({
						title: 'Invalid',
						category,
						content: 'Invalid category.'
					})
				}
			]
		} as OpenAiResponse

		expect(() => parseAssistantResponse(response)).toThrow()
	})

	it('rejects oversized proposal fields', () => {
		const responseWithOversizedTitle = {
			output_text: 'I drafted something.',
			output: [
				{
					type: 'function_call',
					name: 'propose_new_lore',
					arguments: JSON.stringify({
						title: 'x'.repeat(201),
						category: 'worldbuilding',
						content: 'Valid content.'
					})
				}
			]
		} as OpenAiResponse
		const responseWithOversizedContent = {
			output_text: 'I drafted something.',
			output: [
				{
					type: 'function_call',
					name: 'propose_new_lore',
					arguments: JSON.stringify({
						title: 'Valid title',
						category: 'worldbuilding',
						content: 'x'.repeat(1_000_001)
					})
				}
			]
		} as OpenAiResponse

		expect(() => parseAssistantResponse(responseWithOversizedTitle)).toThrow()
		expect(() => parseAssistantResponse(responseWithOversizedContent)).toThrow()
	})

	it('rejects malformed proposal arguments', () => {
		const response = {
			output_text: 'I drafted something.',
			output: [
				{
					type: 'function_call',
					name: 'propose_new_lore',
					arguments: '{'
				}
			]
		} as OpenAiResponse

		expect(() => parseAssistantResponse(response)).toThrow()
	})

	it('advertises only bounded non-session proposals to OpenAI', async () => {
		const create = vi.fn(() => Promise.resolve({ output_text: 'No proposal.', output: [] }))
		const provider = openAiProvider({ responses: { create } } as never)

		await runPromise(
			provider.generateAssistant({
				model: 'assistant-model',
				system: 'System',
				prompt: 'Prompt'
			})
		)

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				tools: [
					expect.objectContaining({
						name: 'propose_new_lore',
						parameters: expect.objectContaining({
							properties: {
								title: { type: 'string', minLength: 1, maxLength: 200 },
								category: {
									type: 'string',
									enum: ['player', 'npc', 'location', 'item', 'worldbuilding', 'event']
								},
								content: { type: 'string', minLength: 1, maxLength: 1_000_000 }
							}
						})
					})
				]
			})
		)
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
