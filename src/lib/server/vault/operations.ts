import { randomUUID } from 'node:crypto'
import { all, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiProvider } from '../ai/provider'
import type * as CampaignDb from '../db/campaign'
import type * as VaultDb from '../db/vault'
import { fail, type Failure } from '../failure'
import type { timelineOperations } from '../timeline/operations'
import {
	parseVaultDocument,
	serializeVaultDocument,
	updateDocumentFrontmatter,
	updateVaultDocumentSource
} from './markdown'
import type { vaultRevisionOperations } from './revisions/operations'
import { sourceHash } from './revisions/operations'
import { documentSummaryPrompt } from './summary'
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
	sourceHash: _sourceHash,
	currentRevisionId: _currentRevisionId,
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
	revisions,
	storage,
	timeline
}: {
	ai: Pick<AiProvider, 'inferDocumentType' | 'generateText'> & {
		documentTypeModel: string
		summaryModel: string
	}
	db: {
		getCampaignById: typeof CampaignDb.getById
		getDocumentPath: typeof VaultDb.getDocumentPath
		getDocumentSummaries: typeof VaultDb.getDocumentSummaries
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
	revisions: ReturnType<typeof vaultRevisionOperations>
	storage: VaultStorage
	timeline: Pick<ReturnType<typeof timelineOperations>, 'validateDocuments'>
}) => {
	const generateDocumentSummary = (document: VaultDocument) =>
		pipe(
			ai.generateText({
				...documentSummaryPrompt(document),
				model: ai.summaryModel
			}),
			map((summary) => summary.trim())
		)

	const attachDocumentSummaries = (campaignId: string) => (documents: VaultDocument[]) => {
		if (!documents.length) return succeed(documents)

		return pipe(
			db.getDocumentSummaries(
				campaignId,
				documents.map(({ id }) => id)
			),
			map((summaries) =>
				documents.map((document) => ({
					...document,
					summary: summaries.get(document.id) ?? document.summary
				}))
			)
		)
	}

	const indexDocumentWithSummary = (campaignId: string, document: VaultDocument) =>
		pipe(
			generateDocumentSummary(document),
			map((summary) => ({ ...document, summary })),
			flatMap((documentWithSummary) =>
				pipe(
					db.indexDocument(campaignId, toDocumentIndex(documentWithSummary)),
					flatMap(() => contextIndex.indexDocument(campaignId, documentWithSummary)),
					map(() => documentWithSummary)
				)
			)
		)

	const ensureCampaignExists = (campaignId: string) =>
		pipe(
			db.getCampaignById(campaignId),
			flatMap((campaign) =>
				campaign ? succeed(undefined) : fail('campaign', 'getCampaign', { campaignId })
			)
		)

	const ensureCampaign = (campaignId: string) =>
		pipe(
			ensureCampaignExists(campaignId),
			flatMap(() => revisions.ensureCampaignReady(campaignId))
		)

	const ensureDocumentMetadata = (
		campaignId: string,
		source: string,
		document: ParsedVaultDocument
	) =>
		gen(function* () {
			const type = yield* document.type
				? succeed(document.type)
				: ai.inferDocumentType({
						model: ai.documentTypeModel,
						path: document.path,
						title: document.title,
						content: document.content
					})
			if (document.after.length && type !== 'event') {
				return yield* fail('vault', 'parseDocument', {
					path: document.path,
					reason: 'eventPredecessorsOnNonEvent',
					type
				})
			}

			const normalizedDocument: VaultDocument = {
				...document,
				id: document.id ?? randomUUID(),
				type,
				summary: document.summary
			}

			if (document.id && document.type) {
				const head = yield* revisions.ensureCurrentRevision(
					campaignId,
					normalizedDocument.id,
					document.path,
					source
				)
				return {
					...normalizedDocument,
					sourceHash: sourceHash(source),
					currentRevisionId: head.revisionId
				}
			}

			const normalizedSource = yield* updateDocumentFrontmatter(source, {
				id: normalizedDocument.id,
				type: normalizedDocument.type
			})
			const revision = yield* revisions.importSnapshot(
				campaignId,
				normalizedDocument.id,
				document.path,
				source,
				normalizedSource
			)
			return {
				...normalizedDocument,
				sourceHash: revision.afterHash ?? undefined,
				currentRevisionId: revision.revisionId
			}
		})

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
			flatMap((document) => indexDocumentWithSummary(campaignId, document))
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
				summary: '',
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
			yield* revisions.create(campaignId, documentId, input.path, source)

			const document = yield* loadDocumentAtPath(campaignId, input.path)

			return yield* indexDocumentWithSummary(campaignId, document)
		})

	const getDocument = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => findDocument(campaignId, documentId)),
			flatMap((document) =>
				pipe(
					attachDocumentSummaries(campaignId)([document]),
					map(([documentWithSummary]) => documentWithSummary)
				)
			)
		)

	type UpdateDocumentInput = {
		type: VaultDocument['type']
		aliases?: string[]
		after?: string[]
		content: string
		expectedSourceHash?: string
		expectedRevisionId?: string
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

	const updateDocumentIndexes = (campaignId: string) => (document: VaultDocument) =>
		indexDocumentWithSummary(campaignId, document)

	const updateDocument = (campaignId: string, documentId: string, input: UpdateDocumentInput) =>
		gen(function* () {
			yield* ensureCampaign(campaignId)
			if (!input.expectedSourceHash || !input.expectedRevisionId) {
				return yield* fail('vaultRevision', 'verifyBase', { reason: 'missingBase' })
			}
			const existing = yield* findDocument(campaignId, documentId)
			const updated = yield* validateDocumentUpdate(campaignId)(
				applyDocumentUpdate(input)(existing)
			)
			const beforeSource = yield* storage.read(campaignId, existing.path)
			const afterSource = yield* updateVaultDocumentSource(
				beforeSource,
				{
					id: updated.id,
					type: updated.type,
					aliases: updated.aliases,
					after: updated.after
				},
				updated.content
			)
			yield* revisions.update(campaignId, documentId, existing.path, beforeSource, afterSource, {
				expectedSourceHash: input.expectedSourceHash,
				expectedRevisionId: input.expectedRevisionId
			})
			const document = yield* findDocument(campaignId, documentId)
			return yield* updateDocumentIndexes(campaignId)(document)
		})

	const deleteDocument = (
		campaignId: string,
		documentId: string,
		options: { expectedSourceHash?: string; expectedRevisionId?: string } = {}
	) =>
		gen(function* () {
			yield* ensureCampaign(campaignId)
			if (!options.expectedSourceHash || !options.expectedRevisionId) {
				return yield* fail('vaultRevision', 'verifyBase', { reason: 'missingBase' })
			}
			const document = yield* findDocument(campaignId, documentId)
			const beforeSource = yield* storage.read(campaignId, document.path)
			yield* revisions.delete(campaignId, document.id, document.path, beforeSource, {
				expectedSourceHash: options.expectedSourceHash,
				expectedRevisionId: options.expectedRevisionId
			})
			yield* db.deleteDocumentIndex(campaignId, document.id)
			yield* contextIndex.deleteDocumentIndex(campaignId, document.id)
		})

	const listDocuments = (campaignId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocuments(campaignId)),
			flatMap(attachDocumentSummaries(campaignId)),
			map((documents) => documents.map(toDocumentSummary))
		)

	const getDocuments = (campaignId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => loadDocuments(campaignId)),
			flatMap(attachDocumentSummaries(campaignId))
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

	const listDocumentRevisions = (campaignId: string, documentId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => revisions.listRevisions(campaignId, documentId))
		)

	const getDocumentRevision = (campaignId: string, documentId: string, revisionId: string) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => revisions.getRevision(campaignId, documentId, revisionId))
		)

	const diffDocumentRevisions = (
		campaignId: string,
		documentId: string,
		toRevisionId: string,
		fromRevisionId?: string
	) =>
		pipe(
			ensureCampaign(campaignId),
			flatMap(() => revisions.diffRevisions(campaignId, documentId, toRevisionId, fromRevisionId))
		)

	const restoreDocumentRevision = (
		campaignId: string,
		documentId: string,
		revisionId: string,
		options: { expectedSourceHash: string | null; expectedRevisionId: string }
	) =>
		gen(function* () {
			yield* ensureCampaign(campaignId)
			const selected = yield* revisions.getRevision(campaignId, documentId, revisionId)
			if (selected.snapshot === null) {
				return yield* fail('vaultRevision', 'restoreRevision', { reason: 'deletedSnapshot' })
			}
			const restored = yield* parseVaultDocument(selected.path, selected.snapshot)
			if (!restored.id || !restored.type || restored.id !== documentId) {
				return yield* fail('vaultRevision', 'restoreRevision', {
					reason: 'invalidSnapshot',
					revisionId
				})
			}
			const documents = yield* loadDocuments(campaignId)
			const projected: VaultDocument = {
				...restored,
				id: restored.id,
				type: restored.type
			}
			yield* timeline.validateDocuments([
				...documents.filter((document) => document.id !== documentId),
				projected
			])
			const restoreRevision = yield* revisions.restore(campaignId, documentId, revisionId, options)
			const document = yield* loadDocumentAtPath(campaignId, restoreRevision.path)
			return yield* indexDocumentWithSummary(campaignId, document)
		})

	const recoverRevisions = (campaignId: string) =>
		pipe(
			ensureCampaignExists(campaignId),
			flatMap(() => revisions.recoverCampaign(campaignId))
		)

	const reindexCampaign = (campaignId: string) =>
		gen(function* () {
			yield* ensureCampaign(campaignId)
			yield* revisions.rebuildIndex(campaignId)
			const documents = yield* loadDocuments(campaignId)
			const documentsWithSummaries = yield* all(
				documents.map((document) =>
					pipe(
						generateDocumentSummary(document),
						map((summary) => ({ ...document, summary }))
					)
				)
			)

			yield* db.replaceCampaignIndex(campaignId, documentsWithSummaries.map(toDocumentIndex))
			yield* contextIndex.reindexCampaign(campaignId, documentsWithSummaries)

			return documentsWithSummaries
		})

	return {
		createDocument,
		deleteDocument,
		diffDocumentRevisions,
		getBacklinks,
		getDocument,
		getDocumentRevision,
		getDocuments,
		getOutgoingLinks,
		indexDocument,
		listDocumentRevisions,
		listDocuments,
		recoverRevisions,
		reindexCampaign,
		restoreDocumentRevision,
		updateDocument
	}
}
