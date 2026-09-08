import { flip, runPromise, runSync, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { EmbedTexts } from '../../ai/provider'
import { mockAiProvider } from '../../ai/providers/mock'
import type { CachedEmbedding } from '../../db/context'
import type { VaultDocument } from '../../vault/types'
import { parseVaultDocument, serializeVaultDocument } from '../../vault/markdown'
import type { ContextSource, SemanticVectorRecord } from '../types'
import { contextIndexOperations } from './operations'

const campaignId = '17ea64a7-98e4-40de-ae5f-b8e35688e157'
const embeddingModel = 'mock-token-hash-v1'
const document: VaultDocument = {
	id: 'varek',
	path: 'Characters/Varek.md',
	title: 'Varek',
	type: 'npc',
	aliases: ['The Gatekeeper'],
	after: [],
	summary: '',
	content: '# Varek\n\nVarek protects Westgate.',
	links: ['Westgate']
}

const createIndex = (embedTexts: EmbedTexts = vi.fn(mockAiProvider.embedTexts)) => {
	const cache = new Map<string, number[]>()
	const db = {
		deleteDocumentFragments: vi.fn((_campaignId: string, _documentId: string) =>
			succeed(undefined)
		),
		deleteDocumentNames: vi.fn((_campaignId: string, _documentId: string) => succeed(undefined)),
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
		replaceCampaignNames: vi.fn(
			(_campaignId: string, _documents: { documentId: string; normalizedNames: string[] }[]) =>
				succeed(undefined)
		),
		replaceDocumentFragments: vi.fn(
			(_campaignId: string, _documentId: string, _sources: ContextSource[]) => succeed(undefined)
		),
		replaceDocumentNames: vi.fn(
			(_campaignId: string, _documentId: string, _normalizedNames: string[]) => succeed(undefined)
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
			ai: { embedTexts, model: embeddingModel },
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
		expect(db.replaceDocumentNames).toHaveBeenLastCalledWith(campaignId, document.id, [
			'varek',
			'the gatekeeper'
		])
		expect(db.replaceDocumentVectors).toHaveBeenCalledTimes(2)
	})

	it('deduplicates equal fragment content across a campaign rebuild', async () => {
		const { db, embedTexts, index } = createIndex()
		const sharedContent = '# Shared\n\nThe same lore appears here.'

		await runPromise(
			index.reindexCampaign(campaignId, [
				{ ...document, id: 'first', path: 'Lore/First.md', content: sharedContent },
				{ ...document, id: 'second', path: 'Lore/Second.md', content: sharedContent }
			])
		)

		expect(embedTexts).toHaveBeenCalledWith({
			model: embeddingModel,
			values: [sharedContent]
		})
		expect(db.replaceCampaignNames).toHaveBeenCalledWith(campaignId, [
			{ documentId: 'first', normalizedNames: ['varek', 'the gatekeeper'] },
			{ documentId: 'second', normalizedNames: ['varek', 'the gatekeeper'] }
		])
	})

	it('indexes only the recap of a Session document', async () => {
		const { db, embedTexts, index } = createIndex()
		const source = serializeVaultDocument(
			{ id: 'session-12', type: 'session', ingestionId: 'ingestion-12' },
			'# Session 12\n\nThe party entered Westgate.',
			'PRIVATE TRANSCRIPT DETAIL'
		)
		const parsed = runSync(parseVaultDocument('Sessions/Session 12.md', source))
		const session: VaultDocument = {
			...parsed,
			id: parsed.id!,
			type: parsed.type!
		}

		await runPromise(index.indexDocument(campaignId, session))

		expect(embedTexts).toHaveBeenCalledWith({
			model: embeddingModel,
			values: ['# Session 12\n\nThe party entered Westgate.']
		})
		expect(db.replaceDocumentFragments).not.toHaveBeenCalledWith(
			campaignId,
			session.id,
			expect.arrayContaining([
				expect.objectContaining({
					fragment: expect.objectContaining({ content: expect.stringContaining('PRIVATE') })
				})
			])
		)
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
		expect(db.deleteDocumentNames).toHaveBeenCalledWith(campaignId, document.id)
		expect(db.deleteDocumentVectors).toHaveBeenCalledWith(campaignId, document.id)
	})
})
