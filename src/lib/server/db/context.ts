import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { ContextSource } from '../context/types'
import { failure } from '../failure'
import { db } from '.'
import { contextDocumentNames, contextEmbeddingCache, contextFragments } from './schema'

const DEFAULT_LEXICAL_RESULTS = 50
const LEXICAL_RANK_SCALE = 2
const LEXICAL_CONTENT_WEIGHT = 1
const LEXICAL_HEADING_WEIGHT = 2
const LEXICAL_ALIASES_WEIGHT = 3
const LEXICAL_TITLE_WEIGHT = 5

export type LexicalFragmentMatch = {
	source: ContextSource
	score: number
}

export type CachedEmbedding = {
	contentHash: string
	embedding: number[]
}

const fragmentValues = (source: ContextSource) => ({
	id: source.fragment.id,
	campaignId: source.fragment.campaignId,
	documentId: source.fragment.documentId,
	title: source.fragment.title,
	aliases: source.aliases ?? [],
	aliasesText: source.aliases?.join(' ') ?? '',
	documentType: source.fragment.documentType,
	heading: source.fragment.heading ?? null,
	content: source.fragment.content,
	position: source.fragment.position,
	contentHash: source.fragment.contentHash,
	indexedAt: new Date().toISOString()
})

const toSource = ({
	id,
	campaignId,
	documentId,
	title,
	aliases,
	documentType,
	heading,
	content,
	position,
	contentHash
}: typeof contextFragments.$inferSelect): ContextSource => ({
	fragment: {
		id,
		campaignId,
		documentId,
		title,
		documentType,
		...(heading ? { heading } : {}),
		content,
		position,
		contentHash
	},
	...(aliases.length ? { aliases } : {})
})

export const replaceDocumentFragments = (
	campaignId: string,
	documentId: string,
	sources: ContextSource[]
) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.delete(contextFragments)
					.where(
						and(
							eq(contextFragments.campaignId, campaignId),
							eq(contextFragments.documentId, documentId)
						)
					)

				if (sources.length) {
					await transaction.insert(contextFragments).values(sources.map(fragmentValues))
				}
			}),
		catch: (cause) => failure('database', 'replaceDocumentFragments', cause)
	})

export const deleteDocumentFragments = (campaignId: string, documentId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.delete(contextFragments)
					.where(
						and(
							eq(contextFragments.campaignId, campaignId),
							eq(contextFragments.documentId, documentId)
						)
					),
			catch: (cause) => failure('database', 'deleteDocumentFragments', cause)
		}),
		map(() => undefined)
	)

export const replaceCampaignFragments = (campaignId: string, sources: ContextSource[]) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.delete(contextFragments)
					.where(eq(contextFragments.campaignId, campaignId))

				if (sources.length) {
					await transaction.insert(contextFragments).values(sources.map(fragmentValues))
				}
			}),
		catch: (cause) => failure('database', 'replaceCampaignFragments', cause)
	})

export const replaceDocumentNames = (
	campaignId: string,
	documentId: string,
	normalizedNames: string[]
) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.delete(contextDocumentNames)
					.where(
						and(
							eq(contextDocumentNames.campaignId, campaignId),
							eq(contextDocumentNames.documentId, documentId)
						)
					)

				if (normalizedNames.length) {
					await transaction.insert(contextDocumentNames).values(
						normalizedNames.map((normalizedName) => ({
							campaignId,
							documentId,
							normalizedName
						}))
					)
				}
			}),
		catch: (cause) => failure('database', 'replaceDocumentNames', cause)
	})

export const deleteDocumentNames = (campaignId: string, documentId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.delete(contextDocumentNames)
					.where(
						and(
							eq(contextDocumentNames.campaignId, campaignId),
							eq(contextDocumentNames.documentId, documentId)
						)
					),
			catch: (cause) => failure('database', 'deleteDocumentNames', cause)
		}),
		map(() => undefined)
	)

export const replaceCampaignNames = (
	campaignId: string,
	documents: { documentId: string; normalizedNames: string[] }[]
) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.delete(contextDocumentNames)
					.where(eq(contextDocumentNames.campaignId, campaignId))

				const names = documents.flatMap(({ documentId, normalizedNames }) =>
					normalizedNames.map((normalizedName) => ({
						campaignId,
						documentId,
						normalizedName
					}))
				)

				if (names.length) {
					await transaction.insert(contextDocumentNames).values(names)
				}
			}),
		catch: (cause) => failure('database', 'replaceCampaignNames', cause)
	})

export const findDocumentIdsByNames = (campaignId: string, normalizedNames: string[]) => {
	if (!normalizedNames.length) return succeed([])

	return pipe(
		tryPromise({
			try: () =>
				db
					.selectDistinct({ documentId: contextDocumentNames.documentId })
					.from(contextDocumentNames)
					.where(
						and(
							eq(contextDocumentNames.campaignId, campaignId),
							inArray(contextDocumentNames.normalizedName, normalizedNames)
						)
					)
					.orderBy(asc(contextDocumentNames.documentId)),
			catch: (cause) => failure('database', 'findContextDocumentIdsByNames', cause)
		}),
		map((rows) => rows.map(({ documentId }) => documentId))
	)
}

export const getFragmentsByIds = (campaignId: string, fragmentIds: string[]) => {
	if (!fragmentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () =>
				db
					.select()
					.from(contextFragments)
					.where(
						and(
							eq(contextFragments.campaignId, campaignId),
							inArray(contextFragments.id, fragmentIds)
						)
					),
			catch: (cause) => failure('database', 'getContextFragmentsByIds', cause)
		}),
		map((rows) => {
			const sourcesById = new Map(rows.map((row) => [row.id, toSource(row)]))

			return fragmentIds.flatMap((fragmentId) => {
				const source = sourcesById.get(fragmentId)
				return source ? [source] : []
			})
		})
	)
}

export const getFragmentsForDocuments = (campaignId: string, documentIds: string[]) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () =>
				db
					.select()
					.from(contextFragments)
					.where(
						and(
							eq(contextFragments.campaignId, campaignId),
							inArray(contextFragments.documentId, documentIds)
						)
					)
					.orderBy(asc(contextFragments.documentId), asc(contextFragments.position)),
			catch: (cause) => failure('database', 'getContextFragmentsForDocuments', cause)
		}),
		map((rows) => rows.map(toSource))
	)
}

export const searchLexicalFragments = (
	campaignId: string,
	terms: string[],
	limit = DEFAULT_LEXICAL_RESULTS
) => {
	if (!terms.length) return succeed([])

	const query = terms.join(' | ')
	const tsquery = sql`to_tsquery('simple', ${query})`
	const score = sql<number>`${LEXICAL_RANK_SCALE} * ts_rank(
			ARRAY[
				${LEXICAL_CONTENT_WEIGHT},
				${LEXICAL_HEADING_WEIGHT},
				${LEXICAL_ALIASES_WEIGHT},
				${LEXICAL_TITLE_WEIGHT}
			]::real[],
			${contextFragments.searchVector},
			${tsquery}
		)`

	return pipe(
		tryPromise({
			try: () =>
				db
					.select({ fragment: contextFragments, score })
					.from(contextFragments)
					.where(
						and(
							eq(contextFragments.campaignId, campaignId),
							sql`${contextFragments.searchVector} @@ ${tsquery}`
						)
					)
					.orderBy(desc(score), asc(contextFragments.id))
					.limit(limit),
			catch: (cause) => failure('database', 'searchContextFragments', cause)
		}),
		map((rows): LexicalFragmentMatch[] =>
			rows.map(({ fragment, score: lexicalScore }) => ({
				source: toSource(fragment),
				score: lexicalScore
			}))
		)
	)
}

export const getCachedEmbeddings = (model: string, contentHashes: string[]) => {
	if (!contentHashes.length) return succeed([])

	return tryPromise({
		try: (): Promise<CachedEmbedding[]> =>
			db
				.select({
					contentHash: contextEmbeddingCache.contentHash,
					embedding: contextEmbeddingCache.embedding
				})
				.from(contextEmbeddingCache)
				.where(
					and(
						eq(contextEmbeddingCache.model, model),
						inArray(contextEmbeddingCache.contentHash, contentHashes)
					)
				),
		catch: (cause) => failure('database', 'getCachedContextEmbeddings', cause)
	})
}

export const upsertCachedEmbeddings = (
	model: string,
	records: { contentHash: string; embedding: number[] }[]
) => {
	if (!records.length) return succeed(undefined)

	return pipe(
		tryPromise({
			try: () =>
				db
					.insert(contextEmbeddingCache)
					.values(records.map((record) => ({ model, ...record })))
					.onConflictDoNothing(),
			catch: (cause) => failure('database', 'upsertCachedContextEmbeddings', cause)
		}),
		map(() => undefined)
	)
}
