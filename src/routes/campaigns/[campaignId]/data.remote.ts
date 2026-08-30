import { command, query } from '$app/server'
import { error } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import { documentTypes } from '#lib/document.js'
import { assistant, lore, vault } from '#lib/server/app.js'
import type { AssistantResponse } from '#lib/server/assistant/types.js'
import { logFailure } from '#lib/server/failure.js'
import type { LoreEntry, LoreSummary } from '#lib/server/lore/types.js'

const campaignId = z.uuid()
const documentId = z.string().trim().min(1).max(200)
const aliases = z.array(z.string().trim().min(1).max(200)).max(50).optional()
const documentType = z.enum(documentTypes)
const documentReference = z
	.object({
		campaignId,
		documentId
	})
	.strict()
const createDocumentInput = z
	.object({
		campaignId,
		path: z.string().trim().min(4).max(500),
		type: documentType,
		aliases,
		content: z.string().max(1_000_000)
	})
	.strict()
const updateDocumentInput = z
	.object({
		campaignId,
		documentId,
		type: documentType,
		aliases,
		content: z.string().max(1_000_000)
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
const askLoremasterInput = z
	.object({
		campaignId,
		message: z.string().trim().min(1).max(2_000),
		history: z
			.array(
				z
					.object({
						role: z.enum(['user', 'assistant']),
						content: z.string().trim().min(1).max(2_000)
					})
					.strict()
			)
			.max(12)
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
	askLoremasterInput,
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

export const listDocuments = query(campaignId, (id) =>
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
			vault.updateDocument(input.campaignId, input.documentId, input),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${input.documentId}" was not found`)
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

export const deleteDocument = command(documentReference, (input) =>
	runPromise(
		pipe(
			vault.deleteDocument(input.campaignId, input.documentId),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${input.documentId}" was not found`)
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
