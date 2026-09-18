import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fail, flip, runPromise, succeed } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAiProvider } from '../ai/providers/mock.js'
import type { Campaign } from '../campaign/types.js'
import { timeline } from '../timeline/index.js'
import { vault } from './index.js'
import { vaultRevision } from './revisions/index.js'
import { filesystemRevisionStorage } from './revisions/storage.js'
import type { RevisionHead, VaultRevision } from './revisions/types.js'
import { filesystemVaultStorage } from './storage/filesystem.js'
import type { RelationshipLink, VaultDocumentIndex } from './types.js'

const campaign: Campaign = {
	id: 'campaign-1',
	name: 'Campaign',
	description: 'Description',
	createdAt: '2026-09-17T00:00:00.000Z'
}

const revisionIds = {
	create: '11111111-1111-5111-8111-111111111111',
	update: '22222222-2222-5222-8222-222222222222',
	event: '33333333-3333-5333-8333-333333333333',
	chronology: '44444444-4444-5444-8444-444444444444'
}

describe('vault mutation reconciliation', () => {
	let root: string
	let indexedDocuments: Map<string, VaultDocumentIndex>
	let relationshipLinks: Map<string, RelationshipLink[]>
	let revisionHeads: Map<string, RevisionHead>
	let revisionRecords: VaultRevision[]
	let failDocumentIndex: boolean
	let failContextIndex: boolean
	let failRelationshipIndex: boolean
	let storage: ReturnType<typeof filesystemVaultStorage>
	let contextIndex: {
		deleteDocumentIndex: ReturnType<typeof vi.fn>
		indexDocument: ReturnType<typeof vi.fn>
		reindexCampaign: ReturnType<typeof vi.fn>
	}
	let operations: ReturnType<typeof vault>

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'loremaster-vault-reconcile-'))
		indexedDocuments = new Map()
		relationshipLinks = new Map()
		revisionHeads = new Map()
		revisionRecords = []
		failDocumentIndex = false
		failContextIndex = false
		failRelationshipIndex = false
		storage = filesystemVaultStorage(root)
		const revisions = vaultRevision({
			db: {
				withAdvisoryLocks: (_keys, effect) => effect(),
				getRevisionHead: (_campaignId, documentId) => succeed(revisionHeads.get(documentId)),
				indexRevision: (revision) => {
					const current = revisionHeads.get(revision.documentId)
					if (
						current &&
						current.revisionId !== revision.revisionId &&
						current.revisionId !== revision.previousRevisionId
					) {
						return fail({
							domain: 'database',
							operation: 'indexVaultRevision',
							cause: new Error('stale revision head')
						})
					}
					if (!revisionRecords.some(({ revisionId }) => revisionId === revision.revisionId)) {
						revisionRecords.push(revision)
					}
					revisionHeads.set(revision.documentId, {
						campaignId: revision.campaignId,
						documentId: revision.documentId,
						revisionId: revision.revisionId,
						path: revision.path,
						sourceHash: revision.afterHash
					})
					return succeed(undefined)
				},
				replaceCampaignRevisionIndex: () => succeed(undefined)
			},
			revisions: filesystemRevisionStorage(root),
			vault: storage
		})
		contextIndex = {
			deleteDocumentIndex: vi.fn(() => succeed(undefined)),
			indexDocument: vi.fn(() => {
				if (failContextIndex) {
					failContextIndex = false
					return fail({
						domain: 'context',
						operation: 'indexDocument',
						cause: new Error('injected context index failure')
					})
				}
				return succeed(undefined)
			}),
			reindexCampaign: vi.fn(() => succeed(undefined))
		}
		operations = vault({
			ai: {
				inferDocumentType: mockAiProvider.inferDocumentType,
				generateText: mockAiProvider.generateText,
				generateRelationshipLinks: mockAiProvider.generateRelationshipLinks,
				documentTypeModel: mockAiProvider.models.documentType,
				summaryModel: mockAiProvider.models.documentSummary,
				relationshipModel: mockAiProvider.models.relationshipLinks
			},
			db: {
				getCampaignById: () => succeed(campaign),
				getDocumentPath: (_campaignId, documentId) =>
					succeed(indexedDocuments.get(documentId)?.path),
				getDocumentSummaries: (_campaignId, documentIds) =>
					succeed(
						new Map(
							documentIds.flatMap((documentId) => {
								const indexed = indexedDocuments.get(documentId)
								return indexed ? [[documentId, indexed.summary]] : []
							})
						)
					),
				getOutgoingLinks: () => succeed([]),
				getBacklinks: () => succeed([]),
				indexDocument: (_campaignId, document) => {
					if (failDocumentIndex) {
						failDocumentIndex = false
						return fail({
							domain: 'database',
							operation: 'indexVaultDocument',
							cause: new Error('injected document index failure')
						})
					}
					indexedDocuments.set(document.id, document)
					return succeed(undefined)
				},
				deleteDocumentIndex: () => succeed(undefined),
				replaceCampaignIndex: () => succeed(undefined),
				replaceRelationshipLinks: (_campaignId, documentId, links) => {
					if (failRelationshipIndex) {
						failRelationshipIndex = false
						return fail({
							domain: 'database',
							operation: 'replaceVaultRelationshipLinks',
							cause: new Error('injected relationship index failure')
						})
					}
					relationshipLinks.set(documentId, links)
					return succeed(undefined)
				}
			},
			contextIndex,
			revisions,
			storage,
			timeline: timeline({
				db: {
					getTimelineEdges: () => succeed([]),
					getTimelineEdgesForDocuments: () => succeed([]),
					getTimelineContainments: () => succeed([]),
					getTimelineContainmentsForDocuments: () => succeed([]),
					getTimelineEvents: () => succeed([]),
					getCampaignTimelineEvents: () => succeed([])
				}
			})
		})
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it('reconciles revision metadata before retrying document indexing', async () => {
		failDocumentIndex = true
		const input = {
			documentId: 'document-1',
			path: 'NPCs/Varek.md',
			type: 'npc' as const,
			content: '# Varek',
			revision: {
				source: 'ingestion' as const,
				relatedSessionId: 'session-1',
				ingestionId: 'ingestion-1',
				changeSummary: 'Created Varek',
				revisionId: revisionIds.create
			}
		}

		await runPromise(flip(operations.createDocument(campaign.id, input)))
		expect(revisionHeads.get(input.documentId)?.revisionId).toBe(revisionIds.create)
		expect(indexedDocuments.has(input.documentId)).toBe(false)

		const recovered = await runPromise(operations.createDocument(campaign.id, input))

		expect(recovered.currentRevisionId).toBe(revisionIds.create)
		expect(indexedDocuments.get(input.documentId)?.content).toBeUndefined()
		expect(contextIndex.indexDocument).toHaveBeenCalled()
		expect(revisionRecords).toHaveLength(1)
	})

	it('retries derived indexes after an update has advanced canonical and revision state', async () => {
		const created = await runPromise(
			operations.createDocument(campaign.id, {
				documentId: 'document-1',
				path: 'NPCs/Varek.md',
				type: 'npc',
				content: '# Varek',
				revision: {
					source: 'ingestion',
					relatedSessionId: 'session-1',
					ingestionId: 'ingestion-1',
					changeSummary: 'Created Varek',
					revisionId: revisionIds.create
				}
			})
		)
		const update = {
			type: 'npc' as const,
			content: '# Varek\n\nGuards the gate.',
			expectedRevisionId: created.currentRevisionId!,
			expectedPath: created.path,
			revision: {
				source: 'ingestion' as const,
				relatedSessionId: 'session-1',
				ingestionId: 'ingestion-1',
				changeSummary: 'Updated Varek',
				revisionId: revisionIds.update
			}
		}
		failContextIndex = true

		await runPromise(flip(operations.updateDocument(campaign.id, created.id, update)))
		expect(revisionHeads.get(created.id)?.revisionId).toBe(revisionIds.update)

		const recovered = await runPromise(operations.updateDocument(campaign.id, created.id, update))

		expect(recovered.content).toBe(update.content)
		expect(recovered.currentRevisionId).toBe(revisionIds.update)
		expect(revisionRecords).toHaveLength(2)
	})

	it('retries relationship indexing for a completed chronology revision', async () => {
		const first = await runPromise(
			operations.createDocument(campaign.id, {
				documentId: 'event-1',
				path: 'Events/First.md',
				type: 'event',
				content: '# First',
				revision: {
					source: 'ingestion',
					relatedSessionId: 'session-1',
					ingestionId: 'ingestion-1',
					changeSummary: 'Created first event',
					revisionId: revisionIds.event
				}
			})
		)
		const second = await runPromise(
			operations.createDocument(campaign.id, {
				documentId: 'event-2',
				path: 'Events/Second.md',
				type: 'event',
				content: '# Second',
				revision: {
					source: 'ingestion',
					relatedSessionId: 'session-1',
					ingestionId: 'ingestion-1',
					changeSummary: 'Created second event',
					revisionId: revisionIds.create
				}
			})
		)
		const chronology = {
			type: 'event' as const,
			after: [first.id],
			during: [],
			eventForm: 'occurrence' as const,
			content: second.content,
			expectedRevisionId: second.currentRevisionId!,
			expectedPath: second.path,
			revision: {
				source: 'ingestion' as const,
				relatedSessionId: 'session-1',
				ingestionId: 'ingestion-1',
				changeSummary: 'Updated chronology',
				revisionId: revisionIds.chronology
			}
		}
		failRelationshipIndex = true

		await runPromise(flip(operations.updateDocument(campaign.id, second.id, chronology)))
		expect(revisionHeads.get(second.id)?.revisionId).toBe(revisionIds.chronology)

		const recovered = await runPromise(
			operations.updateDocument(campaign.id, second.id, chronology)
		)

		expect(recovered.after).toEqual([first.id])
		expect(recovered.currentRevisionId).toBe(revisionIds.chronology)
		expect(relationshipLinks.has(second.id)).toBe(true)
	})

	it('hydrates only requested documents in first-requested order', async () => {
		const list = vi.spyOn(storage, 'list')
		const first = await runPromise(
			operations.createDocument(campaign.id, {
				documentId: 'document-1',
				path: 'NPCs/Varek.md',
				type: 'npc',
				content: '# Varek',
				revision: {
					source: 'ingestion',
					relatedSessionId: 'session-1',
					ingestionId: 'ingestion-1',
					changeSummary: 'Created Varek',
					revisionId: revisionIds.create
				}
			})
		)
		const second = await runPromise(
			operations.createDocument(campaign.id, {
				documentId: 'document-2',
				path: 'NPCs/Mara.md',
				type: 'npc',
				content: '# Mara',
				revision: {
					source: 'ingestion',
					relatedSessionId: 'session-1',
					ingestionId: 'ingestion-1',
					changeSummary: 'Created Mara',
					revisionId: revisionIds.update
				}
			})
		)
		list.mockClear()

		const documents = await runPromise(
			operations.getDocumentsByIds(campaign.id, [
				second.id,
				'missing-document',
				first.id,
				second.id
			])
		)

		expect(list).not.toHaveBeenCalled()
		expect(documents.map(({ id }) => id)).toEqual([second.id, first.id])
		expect(documents.map(({ currentRevisionId }) => currentRevisionId)).toEqual([
			second.currentRevisionId,
			first.currentRevisionId
		])
		expect(documents.map(({ summary }) => summary)).toEqual([
			indexedDocuments.get(second.id)?.summary,
			indexedDocuments.get(first.id)?.summary
		])
	})
})
