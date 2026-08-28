import { and, eq, inArray } from 'drizzle-orm'
import { map, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { resolveVaultLinks } from '../vault/links'
import type { VaultDocumentIndex } from '../vault/types'
import { failure } from '../failure'
import { db } from '.'
import { vaultDocuments, vaultLinks } from './schema'

const documentValues = (campaignId: string, document: VaultDocumentIndex) => ({
	campaignId,
	documentId: document.id,
	path: document.path,
	title: document.title,
	type: document.type ?? null,
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

export const indexDocument = (campaignId: string, document: VaultDocumentIndex) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				const targets = document.links.length
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
				await transaction
					.insert(vaultDocuments)
					.values(documentValues(campaignId, document))
					.onConflictDoUpdate({
						target: [vaultDocuments.campaignId, vaultDocuments.documentId],
						set: {
							path: document.path,
							title: document.title,
							type: document.type ?? null,
							indexedAt: new Date().toISOString()
						}
					})
				await transaction
					.delete(vaultLinks)
					.where(
						and(eq(vaultLinks.campaignId, campaignId), eq(vaultLinks.sourceDocumentId, document.id))
					)
				const links = linkValues(campaignId, document, [
					...targets,
					{ id: document.id, title: document.title }
				])

				if (links.length) {
					await transaction.insert(vaultLinks).values(links)
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
			}),
		catch: (cause) => failure('database', 'replaceCampaignVaultIndex', cause)
	})
