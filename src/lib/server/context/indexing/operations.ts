import { all, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { EmbedTexts } from '../../ai/embeddings'
import type * as ContextDb from '../../db/context'
import type * as VectorDb from '../../db/vector'
import { fail, type Failure } from '../../failure'
import type { VaultDocument } from '../../vault/types'
import { chunkDocument } from '../chunking'
import type { ContextSource, SemanticVectorRecord } from '../types'

type ContextIndexDependencies = {
	ai: {
		embedTexts: EmbedTexts
		model: string
	}
	db: {
		deleteDocumentFragments: typeof ContextDb.deleteDocumentFragments
		getCachedEmbeddings: typeof ContextDb.getCachedEmbeddings
		replaceCampaignFragments: typeof ContextDb.replaceCampaignFragments
		replaceDocumentFragments: typeof ContextDb.replaceDocumentFragments
		upsertCachedEmbeddings: typeof ContextDb.upsertCachedEmbeddings
		deleteDocumentVectors: typeof VectorDb.deleteDocumentVectors
		replaceCampaignVectors: typeof VectorDb.replaceCampaignVectors
		replaceDocumentVectors: typeof VectorDb.replaceDocumentVectors
	}
}

type ContentRecord = {
	contentHash: string
	content: string
}

type EmbeddingRecord = {
	contentHash: string
	embedding: number[]
}

const collectUniqueContent = (sources: ContextSource[]): ContentRecord[] => {
	const contentByHash = new Map<string, string>()

	for (const { fragment } of sources) {
		if (!contentByHash.has(fragment.contentHash)) {
			contentByHash.set(fragment.contentHash, fragment.content)
		}
	}

	return [...contentByHash].map(([contentHash, content]) => ({ contentHash, content }))
}

const toEmbeddingLookup = (records: EmbeddingRecord[]) =>
	new Map(records.map(({ contentHash, embedding }) => [contentHash, embedding]))

const selectUncachedContent = (content: ContentRecord[], embeddingsByHash: Map<string, number[]>) =>
	content.filter(({ contentHash }) => !embeddingsByHash.has(contentHash))

const createVectorRecords = (
	sources: ContextSource[],
	embeddingsByHash: Map<string, number[]>,
	model: string
): Effect<SemanticVectorRecord[], Failure> => {
	const records: SemanticVectorRecord[] = []

	for (const { fragment } of sources) {
		const embedding = embeddingsByHash.get(fragment.contentHash)

		if (!embedding) {
			return fail('context', 'vectorizeFragments', {
				reason: 'missingEmbedding',
				contentHash: fragment.contentHash
			})
		}

		records.push({ fragment, embedding, model })
	}

	return succeed(records)
}

export const contextIndexOperations = ({ ai, db }: ContextIndexDependencies) => {
	const embedAndCacheContent = (
		contentToEmbed: ContentRecord[]
	): Effect<EmbeddingRecord[], Failure> => {
		if (!contentToEmbed.length) return succeed([])

		return gen(function* () {
			const embeddings = yield* ai.embedTexts({
				values: contentToEmbed.map(({ content }) => content)
			})

			if (embeddings.length !== contentToEmbed.length) {
				return yield* fail('context', 'vectorizeFragments', {
					expected: contentToEmbed.length,
					actual: embeddings.length
				})
			}

			const records = contentToEmbed.map(({ contentHash }, index) => ({
				contentHash,
				embedding: embeddings[index] ?? []
			}))

			yield* db.upsertCachedEmbeddings(ai.model, records)

			return records
		})
	}

	const resolveMissingEmbeddings = (
		content: ContentRecord[],
		embeddingsByHash: Map<string, number[]>
	) =>
		gen(function* () {
			const uncachedContent = selectUncachedContent(content, embeddingsByHash)
			const embedded = yield* embedAndCacheContent(uncachedContent)

			return new Map([...embeddingsByHash, ...toEmbeddingLookup(embedded)])
		})

	const buildVectorRecords = (sources: ContextSource[]) => {
		const content = collectUniqueContent(sources)

		return pipe(
			db.getCachedEmbeddings(
				ai.model,
				content.map(({ contentHash }) => contentHash)
			),
			map(toEmbeddingLookup),
			flatMap((embeddingsByHash) => resolveMissingEmbeddings(content, embeddingsByHash)),
			flatMap((embeddingsByHash) => createVectorRecords(sources, embeddingsByHash, ai.model))
		)
	}

	const chunkDocuments = (campaignId: string, documents: VaultDocument[]) =>
		pipe(
			all(documents.map((document) => chunkDocument(campaignId, document))),
			map((sources) => sources.flat())
		)

	const indexDocument = (campaignId: string, document: VaultDocument) =>
		gen(function* () {
			const sources = yield* chunkDocument(campaignId, document)
			const records = yield* buildVectorRecords(sources)

			yield* db.replaceDocumentFragments(campaignId, document.id, sources)
			yield* db.replaceDocumentVectors(campaignId, document.id, records)
		})

	const deleteDocumentIndex = (campaignId: string, documentId: string) =>
		pipe(
			db.deleteDocumentFragments(campaignId, documentId),
			flatMap(() => db.deleteDocumentVectors(campaignId, documentId))
		)

	const reindexCampaign = (campaignId: string, documents: VaultDocument[]) =>
		gen(function* () {
			const sources = yield* chunkDocuments(campaignId, documents)
			const records = yield* buildVectorRecords(sources)

			yield* db.replaceCampaignFragments(campaignId, sources)
			yield* db.replaceCampaignVectors(campaignId, records)
		})

	return { deleteDocumentIndex, indexDocument, reindexCampaign }
}
