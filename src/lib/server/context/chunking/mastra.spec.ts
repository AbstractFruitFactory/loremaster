import { runPromise } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../../vault/types'
import { mastraMarkdownChunker } from './mastra'

const campaignId = '17ea64a7-98e4-40de-ae5f-b8e35688e157'
const document: VaultDocument = {
	id: 'character-varek',
	path: 'Characters/Varek.md',
	title: 'Varek',
	type: 'npc',
	aliases: ['The Gatekeeper'],
	after: [],
	content:
		'# Varek\n\nIntroduction text.\n\n## Secrets\n\nVarek knows the hidden road.\n\n## Allies\n\nMara protects the gate.',
	links: ['Mara']
}

describe('Mastra Markdown chunking', () => {
	it('maps chunks into Loremaster context fragments', async () => {
		const chunkDocument = mastraMarkdownChunker({ maxSize: 60, overlap: 0 })

		const sources = await runPromise(chunkDocument(campaignId, document))

		expect(sources).toHaveLength(3)
		expect(sources[1]).toMatchObject({
			fragment: {
				campaignId,
				documentId: document.id,
				title: 'Varek',
				documentType: 'npc',
				heading: 'Secrets',
				content: 'Secrets\n\nVarek knows the hidden road.',
				position: 1,
				contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
			},
			aliases: ['The Gatekeeper']
		})
		expect(sources.every(({ fragment }) => fragment.id.startsWith(`${document.id}:`))).toBe(true)
	})

	it('generates stable Loremaster fragment IDs', async () => {
		const chunkDocument = mastraMarkdownChunker({ maxSize: 60, overlap: 0 })

		const first = await runPromise(chunkDocument(campaignId, document))
		const second = await runPromise(chunkDocument(campaignId, document))

		expect(first.map(({ fragment }) => fragment.id)).toEqual(
			second.map(({ fragment }) => fragment.id)
		)
	})
})
