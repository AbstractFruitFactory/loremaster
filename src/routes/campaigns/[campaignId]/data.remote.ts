import { command, query } from '$app/server'
import { error } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import { documentTypes } from '#lib/document.js'
import { assistant, lore, vault } from '#lib/server/app.js'
import { askLoremasterCommandSchema } from '#lib/server/assistant/schema.js'
import type { AssistantResponse } from '#lib/server/assistant/types.js'
import { logFailure } from '#lib/server/failure.js'
import type { LoreEntry, LoreSummary } from '#lib/server/lore/types.js'
import type {
	RevisionDiff,
	VaultRevision,
	VaultRevisionMetadata
} from '#lib/server/vault/revisions/types.js'
import type { VaultDocumentSummary } from '#lib/server/vault/types.js'

const campaignId = z.uuid()
const documentId = z.string().trim().min(1).max(200)
const revisionId = z.uuid()
const sourceHash = z.string().regex(/^[a-f0-9]{64}$/)
const aliases = z.array(z.string().trim().min(1).max(200)).max(50).optional()
const eventPredecessors = z.array(documentId).max(100).optional()
const documentType = z.enum(documentTypes)
const documentReference = z
	.object({
		campaignId,
		documentId
	})
	.strict()
const documentsByTypeInput = z
	.object({
		campaignId,
		type: documentType
	})
	.strict()
const createDocumentInput = z
	.object({
		campaignId,
		path: z.string().trim().min(4).max(500),
		type: documentType,
		aliases,
		after: eventPredecessors,
		content: z.string().max(1_000_000)
	})
	.strict()
const updateDocumentInput = z
	.object({
		campaignId,
		documentId,
		type: documentType,
		aliases,
		after: eventPredecessors,
		content: z.string().max(1_000_000),
		expectedSourceHash: sourceHash,
		currentRevisionId: revisionId
	})
	.strict()
const deleteDocumentInput = documentReference
	.extend({
		expectedSourceHash: sourceHash,
		currentRevisionId: revisionId
	})
	.strict()
const revisionReference = documentReference
	.extend({
		revisionId
	})
	.strict()
const revisionDiffInput = documentReference
	.extend({
		toRevisionId: revisionId,
		fromRevisionId: revisionId.optional()
	})
	.strict()
const restoreRevisionInput = revisionReference
	.extend({
		expectedSourceHash: sourceHash.nullable(),
		currentRevisionId: revisionId,
		currentDocumentType: documentType
	})
	.strict()
const loreReference = z
	.object({
		campaignId,
		loreId: documentId
	})
	.strict()
const createLoreInput = z
	.object({
		campaignId,
		title: z.string().trim().min(1).max(200),
		category: documentType,
		content: z.string().trim().min(1).max(1_000_000)
	})
	.strict()
export const listLore = query(campaignId, (id): Promise<LoreSummary[]> =>
	runPromise(
		pipe(
			lore.listLore(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to load campaign lore')
				},
				onSuccess: (entries) => entries
			})
		)
	)
)

export const getLore = query(loreReference, ({ campaignId, loreId }): Promise<LoreEntry> =>
	runPromise(
		pipe(
			lore.getLore(campaignId, loreId),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Lore "${loreId}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to load lore')
				},
				onSuccess: (entry) => entry
			})
		)
	)
)

export const createLore = command(createLoreInput, (input): Promise<LoreEntry> =>
	runPromise(
		pipe(
			lore.createLore(input.campaignId, input),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'createDocument') {
						error(409, `Lore named "${input.title}" already exists in this category`)
					}

					logFailure(failure)
					error(500, 'Unable to add lore')
				},
				onSuccess: (entry) => {
					void listLore(input.campaignId).refresh()
					getLore({ campaignId: input.campaignId, loreId: entry.id }).set(entry)
					return entry
				}
			})
		)
	)
)

export const askLoremaster = command(
	askLoremasterCommandSchema,
	({ campaignId, message, history }): Promise<AssistantResponse> =>
		runPromise(
			pipe(
				assistant.chat(campaignId, message, history),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						logFailure(failure)
						error(500, 'Loremaster could not respond')
					},
					onSuccess: (response) => response
				})
			)
		)
)

const loadVaultDocuments = (id: string): Promise<VaultDocumentSummary[]> =>
	runPromise(
		pipe(
			vault.listDocuments(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to list vault documents')
				},
				onSuccess: (documents) => documents
			})
		)
	)

export const listDocuments = query(campaignId, loadVaultDocuments)

export const listDocumentsByType = query(
	documentsByTypeInput,
	async ({ campaignId, type }): Promise<VaultDocumentSummary[]> =>
		(await loadVaultDocuments(campaignId)).filter((document) => document.type === type)
)

export const getDocument = query(documentReference, ({ campaignId, documentId }) =>
	runPromise(
		pipe(
			vault.getDocument(campaignId, documentId),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${documentId}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to load vault document')
				},
				onSuccess: (document) => document
			})
		)
	)
)

export const listDocumentRevisions = query(
	documentReference,
	({ campaignId, documentId }): Promise<VaultRevisionMetadata[]> =>
		runPromise(
			pipe(
				vault.listDocumentRevisions(campaignId, documentId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						logFailure(failure)
						error(500, 'Unable to load document history')
					},
					onSuccess: (revisions) => revisions
				})
			)
		)
)

export const getDocumentRevision = query(
	revisionReference,
	({ campaignId, documentId, revisionId }): Promise<VaultRevision> =>
		runPromise(
			pipe(
				vault.getDocumentRevision(campaignId, documentId, revisionId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						if (failure.domain === 'revisionStorage' && failure.operation === 'getRevision') {
							error(404, `Revision "${revisionId}" was not found`)
						}

						logFailure(failure)
						error(500, 'Unable to load document revision')
					},
					onSuccess: (revision) => revision
				})
			)
		)
)

export const diffDocumentRevisions = query(
	revisionDiffInput,
	({ campaignId, documentId, toRevisionId, fromRevisionId }): Promise<RevisionDiff> =>
		runPromise(
			pipe(
				vault.diffDocumentRevisions(campaignId, documentId, toRevisionId, fromRevisionId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						if (failure.domain === 'revisionStorage' && failure.operation === 'getRevision') {
							error(404, 'One of the requested revisions was not found')
						}

						logFailure(failure)
						error(500, 'Unable to compare document revisions')
					},
					onSuccess: (diff) => diff
				})
			)
		)
)

export const createDocument = command(createDocumentInput, (input) =>
	runPromise(
		pipe(
			vault.createDocument(input.campaignId, input),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'createDocument') {
						const reason =
							failure.cause && typeof failure.cause === 'object' && 'reason' in failure.cause
								? failure.cause.reason
								: undefined

						if (reason === 'pathExists') {
							error(409, `A document already exists at "${input.path}"`)
						}

						error(400, 'The document path is invalid')
					}

					logFailure(failure)
					error(500, 'Unable to create vault document')
				},
				onSuccess: (document) => {
					void listDocuments(input.campaignId).refresh()
					getDocument({
						campaignId: input.campaignId,
						documentId: document.id
					}).set(document)
					return document
				}
			})
		)
	)
)

export const updateDocument = command(updateDocumentInput, (input) =>
	runPromise(
		pipe(
			vault.updateDocument(input.campaignId, input.documentId, {
				...input,
				expectedRevisionId: input.currentRevisionId
			}),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${input.documentId}" was not found`)
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'verifyBase') {
						error(409, 'This document changed after you opened it. Reload before saving.')
					}

					logFailure(failure)
					error(500, 'Unable to update vault document')
				},
				onSuccess: (document) => {
					void listDocuments(input.campaignId).refresh()
					getDocument({
						campaignId: input.campaignId,
						documentId: document.id
					}).set(document)
					return document
				}
			})
		)
	)
)

export const deleteDocument = command(deleteDocumentInput, (input) =>
	runPromise(
		pipe(
			vault.deleteDocument(input.campaignId, input.documentId, {
				expectedSourceHash: input.expectedSourceHash,
				expectedRevisionId: input.currentRevisionId
			}),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${input.documentId}" was not found`)
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'verifyBase') {
						error(409, 'This document changed after you opened it. Reload before deleting.')
					}

					logFailure(failure)
					error(500, 'Unable to delete vault document')
				},
				onSuccess: () => {
					void listDocuments(input.campaignId).refresh()
				}
			})
		)
	)
)

export const restoreDocumentRevision = command(restoreRevisionInput, (input) =>
	runPromise(
		pipe(
			vault.restoreDocumentRevision(input.campaignId, input.documentId, input.revisionId, {
				expectedSourceHash: input.expectedSourceHash,
				expectedRevisionId: input.currentRevisionId
			}),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'revisionStorage' && failure.operation === 'getRevision') {
						error(404, `Revision "${input.revisionId}" was not found`)
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'verifyBase') {
						error(409, 'This document changed after its history loaded. Reload before restoring.')
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'restoreRevision') {
						const reason =
							failure.cause && typeof failure.cause === 'object' && 'reason' in failure.cause
								? failure.cause.reason
								: undefined

						if (reason === 'deletedSnapshot') {
							error(410, 'Deleted document snapshots cannot be restored')
						}

						error(422, 'This revision does not contain a valid document snapshot')
					}

					logFailure(failure)
					error(500, 'Unable to restore document revision')
				},
				onSuccess: (document) => {
					getDocument({
						campaignId: input.campaignId,
						documentId: input.documentId
					}).set(document)
					void listDocumentRevisions({
						campaignId: input.campaignId,
						documentId: input.documentId
					}).refresh()
					void listDocuments(input.campaignId).refresh()
					void listDocumentsByType({
						campaignId: input.campaignId,
						type: document.type
					}).refresh()
					if (input.currentDocumentType !== document.type) {
						void listDocumentsByType({
							campaignId: input.campaignId,
							type: input.currentDocumentType
						}).refresh()
					}
					return document
				}
			})
		)
	)
)

export const reindexCampaignVault = command(campaignId, (id) =>
	runPromise(
		pipe(
			vault.reindexCampaign(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to reindex the campaign vault')
				},
				onSuccess: (documents) => {
					void listDocuments(id).refresh()
					return documents
				}
			})
		)
	)
)
