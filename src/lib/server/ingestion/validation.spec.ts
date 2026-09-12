import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyzeSessionChunk } from '../ai/provider'
import type { VaultDocument } from '../vault/types'
import { sessionIngestionOperations } from './operations'
import type { ExtractedSessionClaim, SessionIngestionDraft } from './types'

const extractedClaim: ExtractedSessionClaim = {
	excerpt: 'Mara opened the gate.',
	kind: 'stable-fact',
	certainty: 'explicit',
	content: 'Mara opened the gate.',
	entityMentions: [{ mention: 'Mara', type: 'npc' }]
}

const operationsWith = (
	analyzeSessionChunk: AnalyzeSessionChunk
): ReturnType<typeof sessionIngestionOperations> =>
	sessionIngestionOperations({
		ai: {
			analysisModel: 'analysis-model',
			analyzeSessionChunk,
			resolveSessionEntities: () => succeed([])
		},
		storage: {
			write: () => succeed(undefined),
			read: () => succeed({} as SessionIngestionDraft),
			readTranscript: () => succeed('')
		},
		vault: {
			getDocuments: () => succeed([]),
			createDocument: () => succeed({} as VaultDocument),
			updateDocument: () => succeed({} as VaultDocument)
		}
	})

describe('session claim validation', () => {
	it('discards an evidence-backed claim that the validation pass does not confirm', async () => {
		let call = 0
		const analyzeSessionChunk = vi.fn(() => succeed(call++ === 0 ? [extractedClaim] : []))
		const operations = operationsWith(analyzeSessionChunk)

		const draft = await runPromise(
			operations.analyze({
				campaignId: 'campaign',
				title: 'Session 1',
				transcript: 'Mara opened the gate.'
			})
		)

		expect(analyzeSessionChunk).toHaveBeenCalledTimes(2)
		expect(draft.proposals).toHaveLength(1)
		expect(draft.proposals[0]?.documentType).toBe('session')
		expect(draft.warnings).toContain(
			'chunk-1 claim 1 was discarded because model validation did not confirm it.'
		)
	})

	it('allows validation to downgrade certainty but never upgrade it', async () => {
		let call = 0
		const analyzeSessionChunk = vi.fn(() =>
			succeed(
				call++ === 0 ? [extractedClaim] : [{ ...extractedClaim, certainty: 'inferred' as const }]
			)
		)
		const operations = operationsWith(analyzeSessionChunk)

		const draft = await runPromise(
			operations.analyze({
				campaignId: 'campaign',
				title: 'Session 1',
				transcript: 'Mara opened the gate.'
			})
		)
		const proposal = draft.proposals.find(({ title }) => title === 'Mara')

		expect(proposal).toMatchObject({ certainty: 'inferred', selected: false })
	})

	it('drops entity mentions that are not actually present in the evidence', async () => {
		const invalidMention = {
			...extractedClaim,
			entityMentions: [{ mention: 'Mara Vale', type: 'npc' as const }]
		}
		let call = 0
		const analyzeSessionChunk = vi.fn(() =>
			succeed(call++ === 0 ? [invalidMention] : [{ ...invalidMention, entityMentions: [] }])
		)
		const operations = operationsWith(analyzeSessionChunk)
		const draft = await runPromise(
			operations.analyze({
				campaignId: 'campaign',
				title: 'Session 1',
				transcript: 'Mara opened the gate.'
			})
		)

		expect(draft.warnings).toContain(
			'chunk-1 claim 1 omitted 1 entity mention that was not present in its evidence.'
		)
		expect(draft.proposals[1]).toMatchObject({ operation: 'record-only' })
	})
})
