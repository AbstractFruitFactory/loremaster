import { randomUUID } from 'node:crypto'
import { all, flatMap, map, succeed } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type * as CampaignDb from '../db/campaign'
import type * as VaultDb from '../db/vault'
import { fail } from '../failure'
import { addDocumentId, parseVaultDocument, serializeVaultDocument } from './markdown'
import type { VaultStorage } from './storage/storage'
import type {
	CreateVaultDocumentInput,
	ParsedVaultDocument,
	UpdateVaultDocumentInput,
	VaultDocument,
	VaultDocumentIndex,
	VaultDocumentSummary
} from './types'

const isValidDocumentPath = (path: string) => {
	const segments = path.split('/')

	return (
		!!path &&
		!path.startsWith('/') &&
		!path.includes('\\') &&
		path.toLowerCase().endsWith('.md') &&
		segments.every((segment) => !!segment && segment !== '.' && segment !== '..')
	)
}

const toDocumentIndex = ({
	content: _content,
	aliases: _aliases,
	...index
}: VaultDocument): VaultDocumentIndex => index

const toDocumentSummary = ({
	content: _content,
	...summary
}: VaultDocument): VaultDocumentSummary => summary

const checkDuplicateIds = (campaignId: string, documents: VaultDocument[]) => {
	const ids = new Set<string>()
	const duplicateIds = new Set<string>()

	for (const { id } of documents) {
		if (ids.has(id)) duplicateIds.add(id)
		ids.add(id)
	}

	return duplicateIds.size
		? fail('vault', 'listDocuments', { campaignId, duplicateIds: [...duplicateIds] })
		: succeed(documents)
}

export const vaultOperations = ({
	db,
	storage
}: {
	db: {
		getCampaignById: typeof CampaignDb.getById
		getDocumentPath: typeof VaultDb.getDocumentPath
		indexDocument: typeof VaultDb.indexDocument
		deleteDocumentIndex: typeof VaultDb.deleteDocumentIndex
		replaceCampaignIndex: typeof VaultDb.replaceCampaignIndex
	}
	storage: VaultStorage
}) => {
	const ensureCampaign = (campaignId: string) =>
		pipe(
			db.getCampaignById(campaignId),
			flatMap((campaign) =>
				campaign ? succeed(undefined) : fail('campaign', 'getCampaign', { campaignId })
			)
		)

	const ensureDocumentId = (campaignId: string, source: string, document: ParsedVaultDocument) => {
		if (document.id) {
			return succeed(document as VaultDocument)
		}

		const identifiedDocument: VaultDocument = {
			...document,
			id: randomUUID()
		}

		return pipe(
			addDocumentId(source, identifiedDocument.id),
			flatMap((identifiedSource) =>
				pipe(
					storage.write(campaignId, document.path, identifiedSource),
					map(() => identifiedDocument)
				)
			)
		)
	}

	const loadDocumentAtPath = (campaignId: string, path: string) =>
		pipe(
			storage.read(campaignId, path),
			flatMap((source) =>
				pipe(
					parseVaultDocument(path, source),
					flatMap((document) => ensureDocumentId(campaignId, source, document))
				)
			)
		)

	const loadDocuments = (campaignId: string) =>
		pipe(
			storage.list(campaignId),
			flatMap((paths) => all(paths.map((path) => loadDocumentAtPath(campaignId, path)))),
			flatMap((documents) => checkDuplicateIds(campaignId, documents)),
			map((documents) => [...documents].sort((left, right) => left.path.localeCompare(right.path)))
		)

	const findDocument = (campaignId: string, documentId: string) =>
		pipe(
			db.getDocumentPath(campaignId, documentId),
			flatMap((path) =>
				path ? succeed(path) : fail('vault', 'getDocument', { campaignId, documentId })
			),
			flatMap((path) => loadDocumentAtPath(campaignId, path)),
			flatMap((document) =>
				document.id === documentId
					? succeed(document)
					: fail('vault', 'getDocument', { campaignId, documentId })
			)
		)

	const indexDocument = (campaignId: string, path: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocumentAtPath(campaignId, path)),
			flatMap((document) =>
				pipe(
					db.indexDocument(campaignId, toDocumentIndex(document)),
					map(() => document)
				)
			)
		)

	const createDocument = (campaignId: string, input: CreateVaultDocumentInput) => {
		if (!isValidDocumentPath(input.path)) {
			return fail('vault', 'createDocument', {
				campaignId,
				path: input.path,
				reason: 'invalidPath'
			})
		}

		const documentId = randomUUID()
		const source = serializeVaultDocument(
			{ id: documentId, type: input.type, aliases: input.aliases },
			input.content
		)

		return pipe(
			ensureCampaign(campaignId),
			flatMap(() => storage.list(campaignId)),
			flatMap((paths) =>
				paths.includes(input.path)
					? fail('vault', 'createDocument', {
							campaignId,
							path: input.path,
							reason: 'pathExists'
						})
					: succeed(undefined)
			),
			flatMap(() => storage.create(campaignId, input.path, source)),
			flatMap(() => loadDocumentAtPath(campaignId, input.path)),
			flatMap((document) =>
				pipe(
					db.indexDocument(campaignId, toDocumentIndex(document)),
					map(() => document)
				)
			)
		)
	}

	const getDocument = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => findDocument(campaignId, documentId))
		)

	const updateDocument = (
		campaignId: string,
		documentId: string,
		input: UpdateVaultDocumentInput
	) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => findDocument(campaignId, documentId)),
			flatMap((existing) =>
				storage.write(
					campaignId,
					existing.path,
					serializeVaultDocument(
						{ id: existing.id, type: input.type, aliases: input.aliases },
						input.content
					)
				)
			),
			flatMap(() => findDocument(campaignId, documentId)),
			flatMap((document) =>
				pipe(
					db.indexDocument(campaignId, toDocumentIndex(document)),
					map(() => document)
				)
			)
		)

	const deleteDocument = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => findDocument(campaignId, documentId)),
			flatMap((document) =>
				pipe(
					storage.delete(campaignId, document.path),
					flatMap(() => db.deleteDocumentIndex(campaignId, document.id))
				)
			)
		)

	const listDocuments = (campaignId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocuments(campaignId)),
			map((documents) => documents.map(toDocumentSummary))
		)

	const reindexCampaign = (campaignId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocuments(campaignId)),
			flatMap((documents) =>
				pipe(
					db.replaceCampaignIndex(campaignId, documents.map(toDocumentIndex)),
					map(() => documents)
				)
			)
		)

	return {
		createDocument,
		deleteDocument,
		getDocument,
		indexDocument,
		listDocuments,
		reindexCampaign,
		updateDocument
	}
}
