import type { Response as OpenAiResponse } from 'openai/resources/responses/responses'
import { runPromise } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { openAiProvider } from './openai.js'
import type { SessionEntityResolutionRequest } from '../../ingestion/types.js'
import { mockAiProvider } from './mock.js'

describe('OpenAI provider', () => {
	it('builds the identity prompt inside the provider from structured evidence and candidates', async () => {
		const references: SessionEntityResolutionRequest[] = [
			{
				referenceId: 'mention-1',
				reference: 'Dereka',
				type: 'npc',
				evidence: 'Dereka served in the War of the Ages.',
				candidates: [
					{
						targetId: 'document:dereka',
						title: 'Dereka Stonehand',
						type: 'npc',
						provenance: 'partial-name',
						context: 'A barbarian who served in the War of the Ages.'
					}
				]
			}
		]
		const resolutions = [
			{ referenceId: 'mention-1', kind: 'existing', targetId: 'document:dereka' }
		]
		const create = vi
			.fn()
			.mockResolvedValue({
				output: [
					{
						type: 'function_call',
						name: 'resolve_session_entities',
						arguments: JSON.stringify({ resolutions })
					}
				]
			})
		const provider = openAiProvider({
			responses: { create },
			embeddings: { create: vi.fn() }
		} as never)
		const result = await runPromise(
			provider.resolveSessionEntities({ model: 'identity-model', references })
		)
		expect(result).toEqual(resolutions)
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'identity-model',
				instructions: expect.stringContaining('Resolve entity identity conservatively'),
				input: JSON.stringify({ references }, null, 2),
				tool_choice: { type: 'function', name: 'resolve_session_entities' }
			})
		)
	})

	it('keeps an empty candidate set unresolved in the mock provider', async () => {
		const result = await runPromise(
			mockAiProvider.resolveSessionEntities({
				model: 'mock',
				references: [
					{
						referenceId: 'mention-1',
						reference: 'the king',
						type: 'npc',
						evidence: 'The king sent a letter.',
						candidates: []
					}
				]
			})
		)
		expect(result).toEqual([
			{
				referenceId: 'mention-1',
				kind: 'defer',
				candidateIds: [],
				reason: 'No candidates supplied.'
			}
		])
	})

	it('preserves event form on extracted event references', async () => {
		const response = {
			output: [
				{
					type: 'function_call',
					name: 'record_session_claims',
					arguments: JSON.stringify({
						claims: [
							{
								kind: 'stable-fact',
								eventTitle: null,
								certainty: 'explicit',
								content: 'The War of the Ages was a war.',
								evidence: [{ startLine: 1, endLine: 1 }],
								entityReferences: [
									{
										label: 'War of the Ages',
										type: 'event',
										role: 'subject',
										eventForm: 'period'
									}
								]
							}
						]
					})
				}
			]
		} as unknown as OpenAiResponse
		const create = vi.fn().mockResolvedValue(response)
		const provider = openAiProvider({
			responses: { create },
			embeddings: { create: vi.fn() }
		} as never)

		const claims = await runPromise(
			provider.analyzeSessionChunk({ model: 'analysis-model', prompt: 'Extract claims.' })
		)

		expect(claims[0]?.entityReferences[0]).toMatchObject({
			label: 'War of the Ages',
			type: 'event',
			eventForm: 'period'
		})
	})

	it('accepts chronology output beyond review commit selection limits', async () => {
		const relations = Array.from({ length: 501 }, (_, index) => ({
			relation: 'before' as const,
			sourceEventId: `source-${index}`,
			targetEventId: `target-${index}`,
			certainty: 'explicit' as const,
			reason: 'Supported by imported evidence.',
			claimIds: Array.from({ length: 101 }, (_, claimIndex) => `claim-${index}-${claimIndex}`)
		}))
		const coverage = Array.from({ length: 501 }, (_, index) => ({
			eventId: `source-${index}`,
			status: 'connected' as const,
			reason: 'Connected by imported evidence.'
		}))
		const response = {
			output: [
				{
					type: 'function_call',
					name: 'record_campaign_import_chronology',
					arguments: JSON.stringify({ relations, coverage })
				}
			]
		} as unknown as OpenAiResponse
		const create = vi.fn().mockResolvedValue(response)
		const provider = openAiProvider({
			responses: { create },
			embeddings: { create: vi.fn() }
		} as never)

		const result = await runPromise(
			provider.inferCampaignImportChronology({
				model: 'analysis-model',
				prompt: 'Infer chronology.'
			})
		)

		expect(result.relations).toHaveLength(501)
		expect(result.relations[0]?.claimIds).toHaveLength(101)
		expect(result.coverage).toHaveLength(501)
	})
})
