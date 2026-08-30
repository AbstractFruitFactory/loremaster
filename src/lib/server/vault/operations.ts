import { randomUUID } from 'node:crypto'
import { all, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiModel } from '../ai/provider'
import type * as CampaignDb from '../db/campaign'
import type * as VaultDb from '../db/vault'
import { fail, type Failure } from '../failure'
import type { timelineOperations } from '../timeline/operations'
import { parseVaultDocument, serializeVaultDocument, updateDocumentFrontmatter } from './markdown'
import type { VaultStorage } from './storage/storage'
import type {
	ParsedVaultDocument,
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
	ai,
	db,
	contextIndex,
	storage,
	timeline
}: {
	ai: AiModel<'inferDocumentType'>
	db: {
		getCampaignById: typeof CampaignDb.getById
		getDocumentPath: typeof VaultDb.getDocumentPath
		getOutgoingLinks: typeof VaultDb.getOutgoingLinks
		getBacklinks: typeof VaultDb.getBacklinks
		indexDocument: typeof VaultDb.indexDocument
		deleteDocumentIndex: typeof VaultDb.deleteDocumentIndex
		replaceCampaignIndex: typeof VaultDb.replaceCampaignIndex
	}
	contextIndex: {
		deleteDocumentIndex: (campaignId: string, documentId: string) => Effect<void, Failure>
		indexDocument: (campaignId: string, document: VaultDocument) => Effect<void, Failure>
		reindexCampaign: (campaignId: string, documents: VaultDocument[]) => Effect<void, Failure>
	}
	storage: VaultStorage
	timeline: Pick<ReturnType<typeof timelineOperations>, 'validateDocuments'>
}) => {
	const ensureCampaign = (campaignId: string) =>
		pipe(
			db.getCampaignById(campaignId),
			flatMap((campaign) =>
				campaign ? succeed(undefined) : fail('campaign', 'getCampaign', { campaignId })
			)
		)

	const ensureDocumentMetadata = (
		campaignId: string,
		source: string,
		document: ParsedVaultDocument
	) =>
		pipe(
			document.type
				? succeed(document.type)
				: ai.inferDocumentType({
						model: ai.model,
						path: document.path,
						title: document.title,
						content: document.content
					}),
			flatMap((type) => {
				if (document.after.length && type !== 'event') {
					return fail('vault', 'parseDocument', {
						path: document.path,
						reason: 'eventPredecessorsOnNonEvent',
						type
					})
				}

				const normalizedDocument: VaultDocument = {
					...document,
					id: document.id ?? randomUUID(),
					type
				}

				if (document.id && document.type) return succeed(normalizedDocument)

				return pipe(
					updateDocumentFrontmatter(source, {
						id: normalizedDocument.id,
						type: normalizedDocument.type
					}),
					flatMap((normalizedSource) => storage.write(campaignId, document.path, normalizedSource)),
					map(() => normalizedDocument)
				)
			})
		)

	const loadDocumentAtPath = (campaignId: string, path: string) =>
		pipe(
			storage.read(campaignId, path),
			flatMap((source) =>
				pipe(
					parseVaultDocument(path, source),
					flatMap((document) => ensureDocumentMetadata(campaignId, source, document))
				)
			)
		)

	const loadDocuments = (campaignId: string) =>
		pipe(
			storage.list(campaignId),
			flatMap((paths) => all(paths.map((path) => loadDocumentAtPath(campaignId, path)))),
			flatMap((documents) => checkDuplicateIds(campaignId, documents)),
			map((documents) => [...documents].sort((left, right) => left.path.localeCompare(right.path))),
			flatMap((documents) =>
				pipe(
					timeline.validateDocuments(documents),
					map(() => documents)
				)
			)
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
			flatMap(() => loadDocuments(campaignId)),
			flatMap((documents) => {
				const document = documents.find((candidate) => candidate.path === path)
				return document ? succeed(document) : fail('vault', 'getDocument', { campaignId, path })
			}),
			flatMap((document) =>
				pipe(
					db.indexDocument(campaignId, toDocumentIndex(document)),
					flatMap(() => contextIndex.indexDocument(campaignId, document)),
					map(() => document)
				)
			)
		)

	const createDocument = (
		campaignId: string,
		input: {
			path: string
			type: VaultDocument['type']
			aliases?: string[]
			after?: string[]
			content: string
		}
	) =>
		gen(function* () {
			if (!isValidDocumentPath(input.path)) {
				return yield* fail('vault', 'createDocument', {
					campaignId,
					path: input.path,
					reason: 'invalidPath'
				})
			}

			const documentId = randomUUID()
			const source = serializeVaultDocument(
				{ id: documentId, type: input.type, aliases: input.aliases, after: input.after },
				input.content
			)
			const proposedDocument: VaultDocument = {
				id: documentId,
				path: input.path,
				title: input.path,
				type: input.type,
				aliases: input.aliases,
				after: input.after ?? [],
				content: input.content,
				links: []
			}

			yield* ensureCampaign(campaignId)
			const documents = yield* loadDocuments(campaignId)

			if (documents.some(({ path }) => path === input.path)) {
				return yield* fail('vault', 'createDocument', {
					campaignId,
					path: input.path,
					reason: 'pathExists'
				})
			}

			yield* timeline.validateDocuments([...documents, proposedDocument])
			yield* storage.create(campaignId, input.path, source)

			const document = yield* loadDocumentAtPath(campaignId, input.path)
			yield* db.indexDocument(campaignId, toDocumentIndex(document))
			yield* contextIndex.indexDocument(campaignId, document)

			return document
		})

	const getDocument = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => findDocument(campaignId, documentId))
		)

	type UpdateDocumentInput = {
		type: VaultDocument['type']
		aliases?: string[]
		after?: string[]
		content: string
	}

	const applyDocumentUpdate =
		(input: UpdateDocumentInput) =>
		(existing: VaultDocument): VaultDocument => ({
			...existing,
			type: input.type,
			aliases: input.aliases,
			after: input.after ?? existing.after,
			content: input.content
		})

	const validateDocumentUpdate = (campaignId: string) => (updated: VaultDocument) =>
		pipe(
			loadDocuments(campaignId),
			map((documents) =>
				documents.map((document) => (document.id === updated.id ? updated : document))
			),
			flatMap(timeline.validateDocuments),
			map(() => updated)
		)

	const writeDocument = (campaignId: string) => (document: VaultDocument) =>
		pipe(
			storage.write(
				campaignId,
				document.path,
				serializeVaultDocument(
					{
						id: document.id,
						type: document.type,
						aliases: document.aliases,
						after: document.after
					},
					document.content
				)
			),
			map(() => document)
		)

	const updateDocumentIndexes = (campaignId: string) => (document: VaultDocument) =>
		pipe(
			db.indexDocument(campaignId, toDocumentIndex(document)),
			flatMap(() => contextIndex.indexDocument(campaignId, document)),
			map(() => document)
		)

	const updateDocument = (campaignId: string, documentId: string, input: UpdateDocumentInput) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => findDocument(campaignId, documentId)),
			map(applyDocumentUpdate(input)),
			flatMap(validateDocumentUpdate(campaignId)),
			flatMap(writeDocument(campaignId)),
			flatMap(() => findDocument(campaignId, documentId)),
			flatMap(updateDocumentIndexes(campaignId))
		)

	const deleteDocument = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => findDocument(campaignId, documentId)),
			flatMap((document) =>
				pipe(
					storage.delete(campaignId, document.path),
					flatMap(() => db.deleteDocumentIndex(campaignId, document.id)),
					flatMap(() => contextIndex.deleteDocumentIndex(campaignId, document.id))
				)
			)
		)

	const listDocuments = (campaignId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocuments(campaignId)),
			map((documents) => documents.map(toDocumentSummary))
		)

	const getDocuments = (campaignId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocuments(campaignId))
		)

	const getOutgoingLinks = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => db.getOutgoingLinks(campaignId, documentId))
		)

	const getBacklinks = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => db.getBacklinks(campaignId, documentId))
		)

	const reindexCampaign = (campaignId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocuments(campaignId)),
			flatMap((documents) =>
				pipe(
					db.replaceCampaignIndex(campaignId, documents.map(toDocumentIndex)),
					flatMap(() => contextIndex.reindexCampaign(campaignId, documents)),
					map(() => documents)
				)
			)
		)

	return {
		createDocument,
		deleteDocument,
		getBacklinks,
		getDocument,
		getDocuments,
		getOutgoingLinks,
		indexDocument,
		listDocuments,
		reindexCampaign,
		updateDocument
	}
}
