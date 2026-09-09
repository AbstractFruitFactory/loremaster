import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { GenerateAssistant, StreamAssistant } from '../ai/provider'
import type { ContextItem } from '../context/types'
import { assistantOperations } from './operations'

const campaignId = '17ea64a7-98e4-40de-ae5f-b8e35688e157'
const assistantModel = 'mock-assistant-v1'
const unusedStreamAssistant = (() => succeed((async function* () {})())) as StreamAssistant
const items: ContextItem[] = [
	{
		fragment: {
			id: 'character-varek',
			campaignId,
			documentId: 'character-varek',
			title: 'Varek',
			documentType: 'npc',
			heading: 'Duties',
			content: '# Varek\n\nVarek keeps watch over the western gate.',
			position: 0,
			contentHash: 'varek-hash'
		},
		score: 156,
		reasons: ['direct-mention', 'lexical-match']
	}
]

describe('assistant operations', () => {
	it('answers with retrieved lore context and sources', async () => {
		const buildAssistantContext = vi.fn(() =>
			succeed({ items, timeline: { events: [], edges: [], layers: [] }, estimatedTokens: 15 })
		)
		const generateAssistant = vi.fn(() =>
			succeed({ message: 'Varek watches the western gate.' })
		) as GenerateAssistant
		const assistant = assistantOperations({
			ai: {
				generateAssistant,
				streamAssistant: unusedStreamAssistant,
				model: assistantModel
			},
			context: { buildAssistantContext }
		})

		const history = [
			{ role: 'user' as const, content: 'Tell me about Westgate.' },
			{ role: 'assistant' as const, content: 'Westgate is the western entrance.' }
		]
		const response = await runPromise(assistant.chat(campaignId, 'What does Varek guard?', history))

		expect(buildAssistantContext).toHaveBeenCalledWith({
			campaignId,
			message: 'What does Varek guard?',
			history
		})
		expect(generateAssistant).toHaveBeenCalledWith(
			expect.objectContaining({
				model: assistantModel,
				prompt: expect.stringMatching(
					/Section: Duties[\s\S]*# Varek[\s\S]*Dungeon Master: Tell me about Westgate/
				)
			})
		)
		expect(response).toEqual({
			message: 'Varek watches the western gate.',
			sources: [{ id: 'character-varek', title: 'Varek', type: 'npc' }]
		})
	})

	it('returns optional lore proposals selected by the AI edge', async () => {
		const buildAssistantContext = vi.fn(() =>
			succeed({ items, timeline: { events: [], edges: [], layers: [] }, estimatedTokens: 15 })
		)
		const generateAssistant = vi.fn(() =>
			succeed({
				message: 'I drafted a warning bell.',
				proposal: {
					title: 'The Westgate Bell',
					category: 'item' as const,
					content: 'The bell rings when danger reaches Westgate.'
				}
			})
		) as GenerateAssistant
		const assistant = assistantOperations({
			ai: {
				generateAssistant,
				streamAssistant: unusedStreamAssistant,
				model: assistantModel
			},
			context: { buildAssistantContext }
		})

		const response = await runPromise(assistant.chat(campaignId, 'Create a warning bell', []))

		expect(response.proposal).toEqual({
			title: 'The Westgate Bell',
			category: 'item',
			content: 'The bell rings when danger reaches Westgate.'
		})
	})

	it('includes partial-order chronology without implying simultaneity', async () => {
		const buildAssistantContext = vi.fn(() =>
			succeed({
				items,
				timeline: {
					events: [
						{ documentId: 'a', title: 'Event A' },
						{ documentId: 'b', title: 'Event B' },
						{ documentId: 'c', title: 'Event C' },
						{ documentId: 'd', title: 'Event D' }
					],
					edges: [
						{ beforeDocumentId: 'a', afterDocumentId: 'b' },
						{ beforeDocumentId: 'b', afterDocumentId: 'c' },
						{ beforeDocumentId: 'b', afterDocumentId: 'd' }
					],
					layers: [['a'], ['b'], ['c', 'd']]
				},
				estimatedTokens: 30
			})
		)
		const generateAssistant = vi.fn(() => succeed({ message: 'Event B came first.' }))
		const assistant = assistantOperations({
			ai: {
				generateAssistant,
				streamAssistant: unusedStreamAssistant,
				model: assistantModel
			},
			context: { buildAssistantContext }
		})

		await runPromise(assistant.chat(campaignId, 'What happened next?', []))

		expect(generateAssistant).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: expect.stringMatching(
					/unknown, not simultaneous[\s\S]*Event A -> Event B[\s\S]*Event B -> Event C[\s\S]*3\. Event C, Event D \(no known order within this group\)/
				)
			})
		)
	})

	it('streams generated events with retrieved lore sources', async () => {
		const buildAssistantContext = vi.fn(() =>
			succeed({ items, timeline: { events: [], edges: [], layers: [] }, estimatedTokens: 15 })
		)
		const generateAssistant = vi.fn(() => succeed({ message: 'Unused' })) as GenerateAssistant
		const streamAssistant = vi.fn(() =>
			succeed(
				(async function* () {
					yield { type: 'text-delta' as const, delta: 'Varek watches ' }
					yield { type: 'text-delta' as const, delta: 'the gate.' }
				})()
			)
		) as StreamAssistant
		const assistant = assistantOperations({
			ai: { generateAssistant, streamAssistant, model: assistantModel },
			context: { buildAssistantContext }
		})

		const stream = await runPromise(assistant.streamChat(campaignId, 'What does Varek guard?', []))
		const events = []
		for await (const event of stream.events) {
			events.push(event)
		}

		expect(events).toEqual([
			{ type: 'text-delta', delta: 'Varek watches ' },
			{ type: 'text-delta', delta: 'the gate.' }
		])
		expect(stream.sources).toEqual([{ id: 'character-varek', title: 'Varek', type: 'npc' }])
		expect(streamAssistant).toHaveBeenCalledWith(
			expect.objectContaining({
				model: assistantModel,
				prompt: expect.stringContaining('What does Varek guard?')
			})
		)
	})

	it('rejects an empty message before building context', async () => {
		const buildAssistantContext = vi.fn(() =>
			succeed({ items, timeline: { events: [], edges: [], layers: [] }, estimatedTokens: 15 })
		)
		const generateAssistant = vi.fn(() => succeed({ message: 'Unused' })) as GenerateAssistant
		const assistant = assistantOperations({
			ai: {
				generateAssistant,
				streamAssistant: unusedStreamAssistant,
				model: assistantModel
			},
			context: { buildAssistantContext }
		})

		const result = await runPromise(flip(assistant.chat(campaignId, '   ', [])))

		expect(result).toMatchObject({
			domain: 'assistant',
			operation: 'chat',
			cause: { reason: 'emptyMessage' }
		})
		expect(buildAssistantContext).not.toHaveBeenCalled()
	})
})
