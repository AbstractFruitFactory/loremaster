import { command, query } from '$app/server'
import { error } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import { vault } from '#lib/server/app.js'

const campaignId = z.uuid()
const documentId = z.string().trim().min(1).max(200)
const aliases = z.array(z.string().trim().min(1).max(200)).max(50).optional()
const documentType = z.string().trim().min(1).max(100).optional()
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

export const listDocuments = query(campaignId, (id) =>
	runPromise(
		pipe(
			vault.listDocuments(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

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
