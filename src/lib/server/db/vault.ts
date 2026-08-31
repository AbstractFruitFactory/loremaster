import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { resolveVaultLinks } from '../vault/links'
import type { VaultDocumentIndex } from '../vault/types'
import { failure } from '../failure'
import { db } from '.'
import { eventChronologyEdges, vaultDocuments, vaultLinks } from './schema'

export type LinkedDocument = {
	seedDocumentId: string
	documentId: string
}

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

export const getOutgoingLinksForDocuments = (campaignId: string, documentIds: string[]) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () =>
				db
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
					),
			catch: (cause) => failure('database', 'getVaultOutgoingLinksForDocuments', cause)
		}),
		map((links): LinkedDocument[] =>
			links.flatMap(({ seedDocumentId, documentId }) =>
				documentId === null ? [] : [{ seedDocumentId, documentId }]
			)
		)
	)
}

export const getBacklinksForDocuments = (campaignId: string, documentIds: string[]) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () =>
				db
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
					),
			catch: (cause) => failure('database', 'getVaultBacklinksForDocuments', cause)
		}),
		map((links): LinkedDocument[] =>
			links.flatMap(({ seedDocumentId, documentId }) =>
				seedDocumentId === null ? [] : [{ seedDocumentId, documentId }]
			)
		)
	)
}

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
				const links = linkValues(campaignId, document, [
					...linkTargets,
					{ id: document.id, title: document.title }
				])
				const chronologyEdges = chronologyEdgeValues(campaignId, document, [
					...predecessorTargets,
					{ id: document.id, type: document.type }
				])

				if (links.length) {
					await transaction.insert(vaultLinks).values(links)
				}
				if (chronologyEdges.length) {
					await transaction.insert(eventChronologyEdges).values(chronologyEdges)
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
			}),
		catch: (cause) => failure('database', 'replaceCampaignVaultIndex', cause)
	})
