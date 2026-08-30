import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
	EMBEDDING_MODEL,
	embedTexts as createEmbeddings,
	type EmbedTexts
} from '../../ai/embeddings'
import type { CachedEmbedding } from '../../db/context'
import type { VaultDocument } from '../../vault/types'
import type { ContextSource, SemanticVectorRecord } from '../types'
import { contextIndexOperations } from './operations'

const campaignId = '17ea64a7-98e4-40de-ae5f-b8e35688e157'
const document: VaultDocument = {
	id: 'varek',
	path: 'Characters/Varek.md',
	title: 'Varek',
	type: 'npc',
	aliases: ['The Gatekeeper'],
	content: '# Varek\n\nVarek protects Westgate.',
	links: ['Westgate']
}

const createIndex = (embedTexts: EmbedTexts = vi.fn(createEmbeddings)) => {
	const cache = new Map<string, number[]>()
	const db = {
		deleteDocumentFragments: vi.fn((_campaignId: string, _documentId: string) =>
			succeed(undefined)
		),
		getCachedEmbeddings: vi.fn((_model: string, contentHashes: string[]) =>
			succeed(
				contentHashes.flatMap((contentHash): CachedEmbedding[] => {
					const embedding = cache.get(contentHash)
					return embedding ? [{ contentHash, embedding }] : []
				})
			)
		),
		replaceCampaignFragments: vi.fn((_campaignId: string, _sources: ContextSource[]) =>
			succeed(undefined)
		),
		replaceDocumentFragments: vi.fn(
			(_campaignId: string, _documentId: string, _sources: ContextSource[]) => succeed(undefined)
		),
		upsertCachedEmbeddings: vi.fn(
			(_model: string, records: { contentHash: string; embedding: number[] }[]) => {
				for (const { contentHash, embedding } of records) cache.set(contentHash, embedding)
				return succeed(undefined)
			}
		),
		deleteDocumentVectors: vi.fn((_campaignId: string, _documentId: string) => succeed(undefined)),
		replaceCampaignVectors: vi.fn((_campaignId: string, _records: SemanticVectorRecord[]) =>
			succeed(undefined)
		),
		replaceDocumentVectors: vi.fn(
			(_campaignId: string, _documentId: string, _records: SemanticVectorRecord[]) =>
				succeed(undefined)
		)
	}

	return {
		db,
		embedTexts,
		index: contextIndexOperations({
			ai: { embedTexts, model: EMBEDDING_MODEL },
			db
		})
	}
}

describe('context index operations', () => {
	it('persists fragments and reuses cached embeddings when content is unchanged', async () => {
		const { db, embedTexts, index } = createIndex()

		await runPromise(index.indexDocument(campaignId, document))
		await runPromise(index.indexDocument(campaignId, document))

		expect(embedTexts).toHaveBeenCalledTimes(1)
		expect(db.upsertCachedEmbeddings).toHaveBeenCalledTimes(1)
		expect(db.replaceDocumentFragments).toHaveBeenLastCalledWith(campaignId, document.id, [
			expect.objectContaining({
				fragment: expect.objectContaining({
					id: expect.stringMatching(/^varek:[a-f0-9]{64}:0$/),
					position: 0,
					contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
				}),
				aliases: ['The Gatekeeper']
			})
		])
		expect(db.replaceDocumentVectors).toHaveBeenCalledTimes(2)
	})

	it('deduplicates equal fragment content across a campaign rebuild', async () => {
		const { embedTexts, index } = createIndex()
		const sharedContent = '# Shared\n\nThe same lore appears here.'

		await runPromise(
			index.reindexCampaign(campaignId, [
				{ ...document, id: 'first', path: 'Lore/First.md', content: sharedContent },
				{ ...document, id: 'second', path: 'Lore/Second.md', content: sharedContent }
			])
		)

		expect(embedTexts).toHaveBeenCalledWith({ values: [sharedContent] })
	})

	it('fails when the embedding provider returns the wrong number of vectors', async () => {
		const { index } = createIndex(vi.fn(() => succeed([])))

		const result = await runPromise(flip(index.indexDocument(campaignId, document)))

		expect(result).toMatchObject({
			domain: 'context',
			operation: 'vectorizeFragments',
			cause: { expected: 1, actual: 0 }
		})
	})

	it('deletes persisted fragments and vectors together', async () => {
		const { db, index } = createIndex()

		await runPromise(index.deleteDocumentIndex(campaignId, document.id))

		expect(db.deleteDocumentFragments).toHaveBeenCalledWith(campaignId, document.id)
		expect(db.deleteDocumentVectors).toHaveBeenCalledWith(campaignId, document.id)
	})
})
