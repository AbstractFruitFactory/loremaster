import { PgVector } from '@mastra/pg'
import { map, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { SemanticSearchResult, SemanticVectorRecord } from '../context/types.js'
import { failure } from '../failure.js'

export const VAULT_FRAGMENT_INDEX = 'vault_fragment_embeddings'

let configuredDatabaseUrl: string | undefined
let store: PgVector | undefined

export const initializeVectorStore = (databaseUrl: string) => {
	if (!databaseUrl) throw new Error('databaseUrl is required')
	if (configuredDatabaseUrl && configuredDatabaseUrl !== databaseUrl) {
		throw new Error('Core vector store is already initialized with a different URL')
	}
	configuredDatabaseUrl = databaseUrl
	store ??= new PgVector({
		id: 'loremaster-vectors',
		connectionString: databaseUrl,
		disableInit: true
	})
	return store
}

export const closeVectorStore = async () => {
	const active = store
	store = undefined
	configuredDatabaseUrl = undefined
	if (active) await active.disconnect()
}

const currentStore = () => {
	if (!store) throw new Error('Core vector store has not been initialized')
	return store
}

const metadata = ({ fragment, model }: SemanticVectorRecord) => ({
	campaignId: fragment.campaignId,
	documentId: fragment.documentId,
	contentHash: fragment.contentHash,
	position: fragment.position,
	model
})

export const replaceDocumentVectors = (
	campaignId: string,
	documentId: string,
	records: SemanticVectorRecord[]
) =>
	tryPromise({
		try: async () => {
			if (!records.length) {
				await currentStore().deleteVectors({
					indexName: VAULT_FRAGMENT_INDEX,
					namespace: campaignId,
					filter: { documentId }
				})
				return
			}

			await currentStore().upsert({
				indexName: VAULT_FRAGMENT_INDEX,
				namespace: campaignId,
				ids: records.map(({ fragment }) => fragment.id),
				vectors: records.map(({ embedding }) => embedding),
				metadata: records.map(metadata),
				deleteFilter: { documentId }
			})
		},
		catch: (cause) => failure('database', 'replaceDocumentVectors', cause)
	})

export const deleteDocumentVectors = (campaignId: string, documentId: string) =>
	tryPromise({
		try: () =>
			currentStore().deleteVectors({
				indexName: VAULT_FRAGMENT_INDEX,
				namespace: campaignId,
				filter: { documentId }
			}),
		catch: (cause) => failure('database', 'deleteDocumentVectors', cause)
	})

export const replaceCampaignVectors = (campaignId: string, records: SemanticVectorRecord[]) =>
	tryPromise({
		try: async () => {
			if (!records.length) {
				await currentStore().deleteVectors({
					indexName: VAULT_FRAGMENT_INDEX,
					namespace: campaignId,
					filter: { campaignId }
				})
				return
			}

			await currentStore().upsert({
				indexName: VAULT_FRAGMENT_INDEX,
				namespace: campaignId,
				ids: records.map(({ fragment }) => fragment.id),
				vectors: records.map(({ embedding }) => embedding),
				metadata: records.map(metadata),
				deleteFilter: { campaignId }
			})
		},
		catch: (cause) => failure('database', 'replaceCampaignVectors', cause)
	})

export const searchVectors = (
	campaignId: string,
	queryVector: number[],
	topK: number,
	minScore: number,
	model: string
) =>
	pipe(
		tryPromise({
			try: () =>
				currentStore().query({
					indexName: VAULT_FRAGMENT_INDEX,
					namespace: campaignId,
					queryVector,
					topK,
					minScore,
					filter: { model }
				}),
			catch: (cause) => failure('database', 'searchVectors', cause)
		}),
		map((results): SemanticSearchResult[] =>
			results.map(({ id, score }) => ({ fragmentId: id, score }))
		)
	)
