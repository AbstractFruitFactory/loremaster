import type { Response as OpenAiResponse } from 'openai/resources/responses/responses'
import { runPromise } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { openAiProvider } from './openai.js'

describe('OpenAI provider', () => {
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
