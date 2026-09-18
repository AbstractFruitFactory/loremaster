import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { resolveVaultLinks } from '../vault/links.js'
import type { RelationshipLink, VaultDocumentIndex } from '../vault/types.js'
import { failure } from '../failure.js'
import { db } from './index.js'
import {
	eventChronologyEdges,
	eventDuringEdges,
	vaultDocuments,
	vaultLinks,
	vaultRelationshipLinks
} from './schema.js'

export type LinkedDocument = {
	seedDocumentId: string
	documentId: string
}

export type RelationshipLinkedDocument = LinkedDocument & {
	relationship: string
}

const inputOrder = (column: AnyPgColumn, values: string[]) =>
	sql<number>`case ${sql.join(
		values.map((value, index) => sql`when ${column} = ${value} then ${index}`),
		sql.raw(' ')
	)} else ${values.length} end`

const documentValues = (campaignId: string, document: VaultDocumentIndex) => ({
	campaignId,
	documentId: document.id,
	path: document.path,
	title: document.title,
	type: document.type,
	summary: document.summary,
	indexedAt: new Date().toISOString()
})

const linkValues = (
	campaignId: string,
	document: VaultDocumentIndex,
	targets: Pick<VaultDocumentIndex, 'id' | 'title'>[]
) =>
	resolveVaultLinks(document.links, targets).map(({ targetName, targetDocumentId }) => ({
		campaignId,
		sourceDocumentId: document.id,
		targetName,
		targetDocumentId
	}))

const chronologyEdgeValues = (
	campaignId: string,
	document: VaultDocumentIndex,
	targets: Pick<VaultDocumentIndex, 'id' | 'type'>[]
) => {
	if (document.type !== 'event') return []

	const eventDocumentIds = new Set(
		targets.filter(({ type }) => type === 'event').map(({ id }) => id)
	)

	return document.after
		.filter((documentId) => eventDocumentIds.has(documentId))
		.map((beforeDocumentId) => ({
			campaignId,
			beforeDocumentId,
			afterDocumentId: document.id
		}))
}

const duringEdgeValues = (
	campaignId: string,
	document: VaultDocumentIndex,
	targets: Pick<VaultDocumentIndex, 'id' | 'type'>[]
) => {
	if (document.type !== 'event') return []
	const eventDocumentIds = new Set(
		targets.filter(({ type }) => type === 'event').map(({ id }) => id)
	)
	return document.during
		.filter((documentId) => eventDocumentIds.has(documentId))
		.map((periodDocumentId) => ({
			campaignId,
			eventDocumentId: document.id,
			periodDocumentId
		}))
}

export const getDocumentSummaries = (campaignId: string, documentIds: string[]) => {
	if (!documentIds.length) return succeed(new Map<string, string>())

	return pipe(
		tryPromise({
			try: () =>
				db
					.select({
						documentId: vaultDocuments.documentId,
						summary: vaultDocuments.summary
					})
					.from(vaultDocuments)
					.where(
						and(
							eq(vaultDocuments.campaignId, campaignId),
							inArray(vaultDocuments.documentId, documentIds)
						)
					),
			catch: (cause) => failure('database', 'getVaultDocumentSummaries', cause)
		}),
		map((rows) => new Map(rows.map(({ documentId, summary }) => [documentId, summary])))
	)
}

export const getDocumentPath = (campaignId: string, documentId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select({ path: vaultDocuments.path })
					.from(vaultDocuments)
					.where(
						and(
							eq(vaultDocuments.campaignId, campaignId),
							eq(vaultDocuments.documentId, documentId)
						)
					)
					.limit(1),
			catch: (cause) => failure('database', 'getVaultDocumentPath', cause)
		}),
		map(([document]): string | undefined => document?.path)
	)

export const getOutgoingLinks = (campaignId: string, documentId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select({ documentId: vaultLinks.targetDocumentId })
					.from(vaultLinks)
					.where(
						and(
							eq(vaultLinks.campaignId, campaignId),
							eq(vaultLinks.sourceDocumentId, documentId),
							isNotNull(vaultLinks.targetDocumentId)
						)
					),
			catch: (cause) => failure('database', 'getVaultOutgoingLinks', cause)
		}),
		map((links) => links.flatMap(({ documentId }) => (documentId === null ? [] : [documentId])))
	)

export const getBacklinks = (campaignId: string, documentId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select({ documentId: vaultLinks.sourceDocumentId })
					.from(vaultLinks)
					.where(
						and(eq(vaultLinks.campaignId, campaignId), eq(vaultLinks.targetDocumentId, documentId))
					),
			catch: (cause) => failure('database', 'getVaultBacklinks', cause)
		}),
		map((links) => links.map(({ documentId }) => documentId))
	)

export const getOutgoingLinksForDocuments = (
	campaignId: string,
	documentIds: string[],
	limit?: number
) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () => {
				const query = db
					.select({
						seedDocumentId: vaultLinks.sourceDocumentId,
						documentId: vaultLinks.targetDocumentId
					})
					.from(vaultLinks)
					.where(
						and(
							eq(vaultLinks.campaignId, campaignId),
							inArray(vaultLinks.sourceDocumentId, documentIds),
							isNotNull(vaultLinks.targetDocumentId)
						)
					)
					.orderBy(
						inputOrder(vaultLinks.sourceDocumentId, documentIds),
						asc(vaultLinks.targetDocumentId)
					)
				return limit === undefined ? query : query.limit(limit)
			},
			catch: (cause) => failure('database', 'getVaultOutgoingLinksForDocuments', cause)
		}),
		map((links): LinkedDocument[] =>
			links.flatMap(({ seedDocumentId, documentId }) =>
				documentId === null ? [] : [{ seedDocumentId, documentId }]
			)
		)
	)
}

export const getBacklinksForDocuments = (
	campaignId: string,
	documentIds: string[],
	limit?: number
) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () => {
				const query = db
					.select({
						seedDocumentId: vaultLinks.targetDocumentId,
						documentId: vaultLinks.sourceDocumentId
					})
					.from(vaultLinks)
					.where(
						and(
							eq(vaultLinks.campaignId, campaignId),
							inArray(vaultLinks.targetDocumentId, documentIds)
						)
					)
					.orderBy(
						inputOrder(vaultLinks.targetDocumentId, documentIds),
						asc(vaultLinks.sourceDocumentId)
					)
				return limit === undefined ? query : query.limit(limit)
			},
			catch: (cause) => failure('database', 'getVaultBacklinksForDocuments', cause)
		}),
		map((links): LinkedDocument[] =>
			links.flatMap(({ seedDocumentId, documentId }) =>
				seedDocumentId === null ? [] : [{ seedDocumentId, documentId }]
			)
		)
	)
}

export const getOutgoingRelationshipLinksForDocuments = (
	campaignId: string,
	documentIds: string[],
	limit?: number
) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () => {
				const query = db
					.select({
						seedDocumentId: vaultRelationshipLinks.sourceDocumentId,
						documentId: vaultRelationshipLinks.targetDocumentId,
						relationship: vaultRelationshipLinks.relationship
					})
					.from(vaultRelationshipLinks)
					.where(
						and(
							eq(vaultRelationshipLinks.campaignId, campaignId),
							inArray(vaultRelationshipLinks.sourceDocumentId, documentIds)
						)
					)
					.orderBy(
						inputOrder(vaultRelationshipLinks.sourceDocumentId, documentIds),
						asc(vaultRelationshipLinks.targetDocumentId),
						asc(vaultRelationshipLinks.relationship)
					)
				return limit === undefined ? query : query.limit(limit)
			},
			catch: (cause) => failure('database', 'getVaultOutgoingRelationshipLinks', cause)
		}),
		map((links): RelationshipLinkedDocument[] => links)
	)
}

export const getIncomingRelationshipLinksForDocuments = (
	campaignId: string,
	documentIds: string[],
	limit?: number
) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () => {
				const query = db
					.select({
						seedDocumentId: vaultRelationshipLinks.targetDocumentId,
						documentId: vaultRelationshipLinks.sourceDocumentId,
						relationship: vaultRelationshipLinks.relationship
					})
					.from(vaultRelationshipLinks)
					.where(
						and(
							eq(vaultRelationshipLinks.campaignId, campaignId),
							inArray(vaultRelationshipLinks.targetDocumentId, documentIds)
						)
					)
					.orderBy(
						inputOrder(vaultRelationshipLinks.targetDocumentId, documentIds),
						asc(vaultRelationshipLinks.sourceDocumentId),
						asc(vaultRelationshipLinks.relationship)
					)
				return limit === undefined ? query : query.limit(limit)
			},
			catch: (cause) => failure('database', 'getVaultIncomingRelationshipLinks', cause)
		}),
		map((links): RelationshipLinkedDocument[] => links)
	)
}

export const replaceRelationshipLinks = (
	campaignId: string,
	sourceDocumentId: string,
	links: RelationshipLink[]
) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.delete(vaultRelationshipLinks)
					.where(
						and(
							eq(vaultRelationshipLinks.campaignId, campaignId),
							eq(vaultRelationshipLinks.sourceDocumentId, sourceDocumentId)
						)
					)

				if (links.length) {
					await transaction.insert(vaultRelationshipLinks).values(
						links.map(({ targetDocumentId, relationship }) => ({
							campaignId,
							sourceDocumentId,
							targetDocumentId,
							relationship
						}))
					)
				}
			}),
		catch: (cause) => failure('database', 'replaceVaultRelationshipLinks', cause)
	})

export const indexDocument = (campaignId: string, document: VaultDocumentIndex) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				const linkTargets = document.links.length
					? await transaction
							.select({ id: vaultDocuments.documentId, title: vaultDocuments.title })
							.from(vaultDocuments)
							.where(
								and(
									eq(vaultDocuments.campaignId, campaignId),
									inArray(vaultDocuments.title, document.links)
								)
							)
					: []
				const predecessorTargets = document.after.length
					? await transaction
							.select({
								id: vaultDocuments.documentId,
								type: vaultDocuments.type
							})
							.from(vaultDocuments)
							.where(
								and(
									eq(vaultDocuments.campaignId, campaignId),
									inArray(vaultDocuments.documentId, document.after)
								)
							)
					: []
				const periodTargets = document.during.length
					? await transaction
							.select({ id: vaultDocuments.documentId, type: vaultDocuments.type })
							.from(vaultDocuments)
							.where(
								and(
									eq(vaultDocuments.campaignId, campaignId),
									inArray(vaultDocuments.documentId, document.during)
								)
							)
					: []
				await transaction
					.insert(vaultDocuments)
					.values(documentValues(campaignId, document))
					.onConflictDoUpdate({
						target: [vaultDocuments.campaignId, vaultDocuments.documentId],
						set: {
							path: document.path,
							title: document.title,
							type: document.type,
							summary: document.summary,
							indexedAt: new Date().toISOString()
						}
					})
				await transaction
					.delete(vaultRelationshipLinks)
					.where(
						and(
							eq(vaultRelationshipLinks.campaignId, campaignId),
							eq(vaultRelationshipLinks.sourceDocumentId, document.id)
						)
					)
				await transaction
					.delete(vaultLinks)
					.where(
						and(eq(vaultLinks.campaignId, campaignId), eq(vaultLinks.sourceDocumentId, document.id))
					)
				await transaction
					.delete(eventChronologyEdges)
					.where(
						and(
							eq(eventChronologyEdges.campaignId, campaignId),
							eq(eventChronologyEdges.afterDocumentId, document.id)
						)
					)
				await transaction
					.delete(eventDuringEdges)
					.where(
						and(
							eq(eventDuringEdges.campaignId, campaignId),
							eq(eventDuringEdges.eventDocumentId, document.id)
						)
					)
				const links = linkValues(campaignId, document, [
					...linkTargets,
					{ id: document.id, title: document.title }
				])
				const chronologyEdges = chronologyEdgeValues(campaignId, document, [
					...predecessorTargets,
					{ id: document.id, type: document.type }
				])
				const duringEdges = duringEdgeValues(campaignId, document, [
					...periodTargets,
					{ id: document.id, type: document.type }
				])

				if (links.length) {
					await transaction.insert(vaultLinks).values(links)
				}
				if (chronologyEdges.length) {
					await transaction.insert(eventChronologyEdges).values(chronologyEdges)
				}
				if (duringEdges.length) {
					await transaction.insert(eventDuringEdges).values(duringEdges)
				}
			}),
		catch: (cause) => failure('database', 'indexVaultDocument', cause)
	})

export const deleteDocumentIndex = (campaignId: string, documentId: string) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.update(vaultLinks)
					.set({ targetDocumentId: null })
					.where(
						and(eq(vaultLinks.campaignId, campaignId), eq(vaultLinks.targetDocumentId, documentId))
					)
				await transaction
					.delete(vaultLinks)
					.where(
						and(eq(vaultLinks.campaignId, campaignId), eq(vaultLinks.sourceDocumentId, documentId))
					)
				await transaction
					.delete(vaultDocuments)
					.where(
						and(
							eq(vaultDocuments.campaignId, campaignId),
							eq(vaultDocuments.documentId, documentId)
						)
					)
			}),
		catch: (cause) => failure('database', 'deleteVaultDocumentIndex', cause)
	})

export const replaceCampaignIndex = (campaignId: string, documents: VaultDocumentIndex[]) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.delete(eventChronologyEdges)
					.where(eq(eventChronologyEdges.campaignId, campaignId))
				await transaction
					.delete(eventDuringEdges)
					.where(eq(eventDuringEdges.campaignId, campaignId))
				await transaction
					.delete(vaultRelationshipLinks)
					.where(eq(vaultRelationshipLinks.campaignId, campaignId))
				await transaction.delete(vaultLinks).where(eq(vaultLinks.campaignId, campaignId))
				await transaction.delete(vaultDocuments).where(eq(vaultDocuments.campaignId, campaignId))

				if (documents.length) {
					await transaction
						.insert(vaultDocuments)
						.values(documents.map((document) => documentValues(campaignId, document)))
				}

				const links = documents.flatMap((document) => linkValues(campaignId, document, documents))

				if (links.length) {
					await transaction.insert(vaultLinks).values(links)
				}

				const chronologyEdges = documents.flatMap((document) =>
					chronologyEdgeValues(campaignId, document, documents)
				)

				if (chronologyEdges.length) {
					await transaction.insert(eventChronologyEdges).values(chronologyEdges)
				}

				const duringEdges = documents.flatMap((document) =>
					duringEdgeValues(campaignId, document, documents)
				)
				if (duringEdges.length) {
					await transaction.insert(eventDuringEdges).values(duringEdges)
				}
			}),
		catch: (cause) => failure('database', 'replaceCampaignVaultIndex', cause)
	})
