import { and, asc, eq } from 'drizzle-orm'
import { map, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { failure } from '../failure'
import type { RevisionHead, VaultRevision } from '../vault/revisions/types'
import { db } from '.'
import { vaultRevisionHeads, vaultRevisions } from './schema'

const revisionValues = (revision: VaultRevision) => ({
	campaignId: revision.campaignId,
	revisionId: revision.revisionId,
	previousRevisionId: revision.previousRevisionId,
	transactionId: revision.transactionId,
	documentId: revision.documentId,
	path: revision.path,
	operation: revision.operation,
	source: revision.source,
	relatedSessionId: revision.relatedSessionId,
	ingestionId: revision.ingestionId,
	createdAt: revision.createdAt,
	beforeHash: revision.beforeHash,
	afterHash: revision.afterHash,
	changeSummary: revision.changeSummary
})

const headValues = (revision: VaultRevision) => ({
	campaignId: revision.campaignId,
	documentId: revision.documentId,
	revisionId: revision.revisionId,
	path: revision.path,
	sourceHash: revision.afterHash
})

const revisionHeads = (revisions: VaultRevision[]) => {
	const byDocument = new Map<string, VaultRevision[]>()
	for (const revision of revisions) {
		const documentRevisions = byDocument.get(revision.documentId) ?? []
		documentRevisions.push(revision)
		byDocument.set(revision.documentId, documentRevisions)
	}

	const heads = new Map<string, VaultRevision>()
	for (const [documentId, documentRevisions] of byDocument) {
		const byId = new Map(documentRevisions.map((revision) => [revision.revisionId, revision]))
		const referenced = new Set(
			documentRevisions.flatMap(({ previousRevisionId }) =>
				previousRevisionId ? [previousRevisionId] : []
			)
		)
		const tips = documentRevisions.filter(({ revisionId }) => !referenced.has(revisionId))
		if (tips.length !== 1) throw Error(`Document ${documentId} has ${tips.length} revision tips`)

		const visited = new Set<string>()
		let current: VaultRevision | undefined = tips[0]
		while (current) {
			if (visited.has(current.revisionId))
				throw Error(`Document ${documentId} has a revision cycle`)
			visited.add(current.revisionId)
			current = current.previousRevisionId ? byId.get(current.previousRevisionId) : undefined
		}
		if (visited.size !== documentRevisions.length) {
			throw Error(`Document ${documentId} has disconnected revision branches`)
		}
		heads.set(documentId, tips[0])
	}
	return heads
}

export const getRevisionHead = (campaignId: string, documentId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select()
					.from(vaultRevisionHeads)
					.where(
						and(
							eq(vaultRevisionHeads.campaignId, campaignId),
							eq(vaultRevisionHeads.documentId, documentId)
						)
					)
					.limit(1),
			catch: (cause) => failure('database', 'getVaultRevisionHead', cause)
		}),
		map(([head]): RevisionHead | undefined => head)
	)

export const indexRevision = (revision: VaultRevision) =>
	tryPromise({
		try: () =>
			db.transaction(async (transaction) => {
				await transaction
					.insert(vaultRevisions)
					.values(revisionValues(revision))
					.onConflictDoNothing()
				await transaction
					.insert(vaultRevisionHeads)
					.values(headValues(revision))
					.onConflictDoUpdate({
						target: [vaultRevisionHeads.campaignId, vaultRevisionHeads.documentId],
						set: {
							revisionId: revision.revisionId,
							path: revision.path,
							sourceHash: revision.afterHash
						}
					})
			}),
		catch: (cause) => failure('database', 'indexVaultRevision', cause)
	})

export const listRevisionMetadata = (campaignId: string, documentId: string) =>
	tryPromise({
		try: () =>
			db
				.select()
				.from(vaultRevisions)
				.where(
					and(eq(vaultRevisions.campaignId, campaignId), eq(vaultRevisions.documentId, documentId))
				)
				.orderBy(asc(vaultRevisions.createdAt)),
		catch: (cause) => failure('database', 'listVaultRevisionMetadata', cause)
	})

export const replaceCampaignRevisionIndex = (campaignId: string, revisions: VaultRevision[]) =>
	tryPromise({
		try: () => {
			const heads = revisionHeads(revisions)
			return db.transaction(async (transaction) => {
				await transaction
					.delete(vaultRevisionHeads)
					.where(eq(vaultRevisionHeads.campaignId, campaignId))
				await transaction.delete(vaultRevisions).where(eq(vaultRevisions.campaignId, campaignId))

				const ordered = [...revisions].sort((left, right) =>
					left.createdAt.localeCompare(right.createdAt)
				)
				if (ordered.length) {
					await transaction.insert(vaultRevisions).values(ordered.map(revisionValues))
				}

				if (heads.size) {
					await transaction.insert(vaultRevisionHeads).values([...heads.values()].map(headValues))
				}
			})
		},
		catch: (cause) => failure('database', 'replaceCampaignVaultRevisionIndex', cause)
	})
