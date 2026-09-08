import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../vault/types'
import { sessionIngestionOperations } from './operations'
import type { SessionIngestionDraft } from './types'

const varek: VaultDocument = {
	id: 'varek',
	path: 'NPCs/Varek.md',
	title: 'Varek',
	type: 'npc',
	aliases: ['The Gatekeeper'],
	after: [],
	summary: '',
	content: '# Varek',
	links: [],
	currentRevisionId: 'revision-varek'
}

describe('session ingestion operations', () => {
	it('keeps only evidence-backed claims and persists a non-canonical review draft', async () => {
		let saved: SessionIngestionDraft | undefined
		let savedTranscript = ''
		const write = vi.fn((draft: SessionIngestionDraft, transcript: string) => {
			saved = draft
			savedTranscript = transcript
			return succeed(undefined)
		})
		const operations = sessionIngestionOperations({
			ai: {
				analysisModel: 'analysis-model',
				summaryModel: 'summary-model',
				analyzeSessionChunk: () =>
					succeed([
						{
							excerpt: 'Varek opened the gate.',
							title: 'The Gatekeeper',
							documentType: 'npc',
							kind: 'stable-fact',
							certainty: 'explicit',
							content: 'Varek can open the western gate.',
							references: ['Varek'],
							after: []
						},
						{
							excerpt: 'This was never said.',
							title: 'Invented claim',
							documentType: 'lore',
							kind: 'stable-fact',
							certainty: 'explicit',
							content: 'Invented content.',
							references: [],
							after: []
						}
					]),
				generateText: () => succeed('Varek opened the gate for the party.')
			},
			storage: {
				write,
				read: () => succeed(saved!)
			},
			vault: { getDocuments: () => succeed([varek]) }
		})
		const transcript = 'GM: The party waits.\nVarek opened the gate.'
		const draft = await runPromise(
			operations.analyze({ campaignId: 'campaign', title: 'Session 12', transcript })
		)

		expect(saved).toEqual(draft)
		expect(savedTranscript).toBe(transcript)
		expect(draft.warnings).toHaveLength(1)
		expect(draft.proposals).toHaveLength(2)
		expect(draft.proposals[0]).toMatchObject({ documentType: 'session', selected: true })
		expect(draft.proposals[1]).toMatchObject({
			operation: 'update-canon',
			selected: true,
			match: { kind: 'exact', documentId: 'varek' },
			base: { documentId: 'varek', revisionId: 'revision-varek' }
		})
		expect(draft.proposals.flatMap(({ content }) => content)).not.toContain('Invented content.')
	})
})
