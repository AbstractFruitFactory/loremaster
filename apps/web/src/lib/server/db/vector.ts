import { PgVector } from '@mastra/pg'
import { map, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { SemanticSearchResult, SemanticVectorRecord } from '../context/types'
import { failure } from '../failure'
import { DATABASE_URL } from '$app/env/private'

export const VAULT_FRAGMENT_INDEX = 'vault_fragment_embeddings'

const store = new PgVector({
	id: 'loremaster-vectors',
	connectionString: DATABASE_URL,
	disableInit: true
})

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
				await store.deleteVectors({
					indexName: VAULT_FRAGMENT_INDEX,
					namespace: campaignId,
					filter: { documentId }
				})
				return
			}

			await store.upsert({
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
			store.deleteVectors({
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
				await store.deleteVectors({
					indexName: VAULT_FRAGMENT_INDEX,
					namespace: campaignId,
					filter: { campaignId }
				})
				return
			}

			await store.upsert({
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
				store.query({
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
