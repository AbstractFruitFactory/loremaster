import type { Response as OpenAiResponse } from 'openai/resources/responses/responses'
import { runPromise } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { openAiProvider } from './openai.js'

describe('OpenAI campaign import chronology provider', () => {
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
