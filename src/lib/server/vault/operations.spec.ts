import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flip, runPromise, runSync, succeed } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InferDocumentType } from '../ai/provider'
import { mockAiProvider } from '../ai/providers/mock'
import type { Campaign } from '../campaign/types'
import { timelineOperations } from '../timeline/operations'
import { filesystemVaultStorage } from './storage/filesystem'
import { parseVaultDocument } from './markdown'
import { vaultOperations } from './operations'
import type { VaultDocumentIndex } from './types'

type VaultDatabase = Parameters<typeof vaultOperations>[0]['db']
type ContextIndex = Parameters<typeof vaultOperations>[0]['contextIndex']

const campaign: Campaign = {
	id: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
	name: 'Curse of Blackwood',
	description: 'A gothic campaign.',
	createdAt: '2026-08-28T00:00:00.000Z'
}
const documentTypeModel = 'mock-document-type-v1'

describe('vault operations', () => {
	let root: string
	let backlinks: Map<string, string[]>
	let indexedDocuments: Map<string, VaultDocumentIndex>
	let operations: ReturnType<typeof vaultOperations>
	let outgoingLinks: Map<string, string[]>
	let contextIndex: ContextIndex
	let inferDocumentType: InferDocumentType
	let storage: ReturnType<typeof filesystemVaultStorage>

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'loremaster-vault-'))
		backlinks = new Map()
		indexedDocuments = new Map()
		outgoingLinks = new Map()
		storage = filesystemVaultStorage(root)
		inferDocumentType = vi.fn(mockAiProvider.inferDocumentType)
		contextIndex = {
			deleteDocumentIndex: vi.fn(() => succeed(undefined)),
			indexDocument: vi.fn(() => succeed(undefined)),
			reindexCampaign: vi.fn(() => succeed(undefined))
		}

		const db: VaultDatabase = {
			getCampaignById: () => succeed(campaign),
			getDocumentPath: (_campaignId, documentId) => succeed(indexedDocuments.get(documentId)?.path),
			getOutgoingLinks: (_campaignId, documentId) => succeed(outgoingLinks.get(documentId) ?? []),
			getBacklinks: (_campaignId, documentId) => succeed(backlinks.get(documentId) ?? []),
			indexDocument: (_campaignId, document) => {
				indexedDocuments.set(document.id, document)
				return succeed(undefined)
			},
			deleteDocumentIndex: (_campaignId, documentId) => {
				indexedDocuments.delete(documentId)
				return succeed(undefined)
			},
			replaceCampaignIndex: (_campaignId, documents) => {
				indexedDocuments = new Map(documents.map((document) => [document.id, document]))
				return succeed(undefined)
			}
		}

		operations = vaultOperations({
			ai: {
				inferDocumentType,
				model: documentTypeModel
			},
			db,
			contextIndex,
			storage,
			timeline: timelineOperations({
				db: {
					getTimelineEdges: () => succeed([]),
					getTimelineEdgesForDocuments: () => succeed([]),
					getTimelineEvents: () => succeed([])
				}
			})
		})
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it('lists an absent vault without creating its directory', async () => {
		expect(await runPromise(storage.list(campaign.id))).toEqual([])
		await expect(stat(join(root, campaign.id))).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('creates, indexes, and reads a document from the filesystem', async () => {
		const created = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				type: 'npc',
				aliases: ['Varek the Innkeeper'],
				content: '# Varek\n\nLives in [[Westgate]].'
			})
		)
		const loaded = await runPromise(operations.getDocument(campaign.id, created.id))
		const [fullDocument] = await runPromise(operations.getDocuments(campaign.id))
		const [listed] = await runPromise(operations.listDocuments(campaign.id))

		expect(loaded).toEqual(created)
		expect(fullDocument).toEqual(created)
		expect(listed).not.toHaveProperty('content')
		expect(contextIndex.indexDocument).toHaveBeenCalledWith(campaign.id, created)
		expect(indexedDocuments.get(created.id)).toEqual({
			id: created.id,
			path: 'Characters/Varek.md',
			title: 'Varek',
			type: 'npc',
			after: [],
			links: ['Westgate']
		})
		expect(
			runSync(
				parseVaultDocument(
					'Characters/Varek.md',
					await readFile(join(root, campaign.id, 'Characters', 'Varek.md'), 'utf8')
				)
			).id
		).toBe(created.id)
	})

	it('indexes event precedence and rejects chronology cycles before writing', async () => {
		const first = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Events/First.md',
				type: 'event',
				content: '# First'
			})
		)
		const second = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Events/Second.md',
				type: 'event',
				after: [first.id],
				content: '# Second'
			})
		)

		expect(indexedDocuments.get(second.id)?.after).toEqual([first.id])

		const failure = await runPromise(
			flip(
				operations.updateDocument(campaign.id, first.id, {
					type: 'event',
					after: [second.id],
					content: '# First'
				})
			)
		)
		const unchanged = await runPromise(operations.getDocument(campaign.id, first.id))

		expect(failure).toMatchObject({
			domain: 'timeline',
			operation: 'validateChronology',
			cause: { reason: 'cycle' }
		})
		expect(unchanged.after).toEqual([])
	})

	it('loads an indexed document without listing the vault', async () => {
		const created = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				type: 'npc',
				content: '# Varek'
			})
		)
		const list = vi.spyOn(storage, 'list')

		const loaded = await runPromise(operations.getDocument(campaign.id, created.id))

		expect(loaded).toEqual(created)
		expect(list).not.toHaveBeenCalled()
	})

	it('synchronizes the context index when indexing an imported document', async () => {
		await runPromise(
			storage.write(
				campaign.id,
				'NPCs/Mara.md',
				`---
id: character-mara
---

# Mara`
			)
		)

		const document = await runPromise(operations.indexDocument(campaign.id, 'NPCs/Mara.md'))

		expect(document.type).toBe('npc')
		expect(inferDocumentType).toHaveBeenCalledWith({
			model: documentTypeModel,
			path: 'NPCs/Mara.md',
			title: 'Mara',
			content: '# Mara'
		})
		expect(contextIndex.indexDocument).toHaveBeenCalledWith(campaign.id, document)
		expect(await readFile(join(root, campaign.id, 'NPCs', 'Mara.md'), 'utf8')).toContain(
			'type: npc'
		)
	})

	it('replaces indexed links when a document changes', async () => {
		const created = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				type: 'npc',
				content: '# Varek\n\nLives in [[Westgate]].'
			})
		)

		await runPromise(
			operations.updateDocument(campaign.id, created.id, {
				type: 'npc',
				content: '# Varek\n\nWorks with [[Ashen Council|the council]].'
			})
		)

		expect(indexedDocuments.get(created.id)?.links).toEqual(['Ashen Council'])
		expect(contextIndex.indexDocument).toHaveBeenLastCalledWith(
			campaign.id,
			expect.objectContaining({ id: created.id, links: ['Ashen Council'] })
		)
	})

	it('removes derived context when deleting a document', async () => {
		const created = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				type: 'npc',
				content: '# Varek'
			})
		)

		await runPromise(operations.deleteDocument(campaign.id, created.id))

		expect(contextIndex.deleteDocumentIndex).toHaveBeenCalledWith(campaign.id, created.id)
	})

	it('returns resolved outgoing links and backlinks from the vault index', async () => {
		const varek = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				type: 'npc',
				content: '# Varek'
			})
		)
		const mara = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Mara.md',
				type: 'npc',
				content: '# Mara'
			})
		)
		outgoingLinks.set(varek.id, [mara.id])
		backlinks.set(mara.id, [varek.id])

		const outgoing = await runPromise(operations.getOutgoingLinks(campaign.id, varek.id))
		const incoming = await runPromise(operations.getBacklinks(campaign.id, mara.id))

		expect(outgoing).toEqual([mara.id])
		expect(incoming).toEqual([varek.id])
	})

	it('does not overwrite an existing document path', async () => {
		await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				type: 'npc',
				content: '# Varek'
			})
		)

		const result = await runPromise(
			flip(
				operations.createDocument(campaign.id, {
					path: 'Characters/Varek.md',
					type: 'npc',
					content: '# Replacement'
				})
			)
		)

		expect(result).toMatchObject({
			domain: 'vault',
			operation: 'createDocument',
			cause: { reason: 'pathExists' }
		})
		expect(await readFile(join(root, campaign.id, 'Characters', 'Varek.md'), 'utf8')).toContain(
			'# Varek'
		)
	})

	it('rebuilds the index and persists IDs missing from Markdown files', async () => {
		await runPromise(
			storage.write(
				campaign.id,
				'Lore/Creation.md',
				`---
tags:
  - origin
---

# Creation

[[Westgate]]`
			)
		)
		await runPromise(
			storage.write(
				campaign.id,
				'Locations/Westgate.md',
				`---
id: location_westgate
type: location
---

# Westgate`
			)
		)
		indexedDocuments.set('stale', {
			id: 'stale',
			path: 'Lore/Stale.md',
			title: 'Stale',
			type: 'lore',
			after: [],
			links: []
		})

		const documents = await runPromise(operations.reindexCampaign(campaign.id))
		const creation = documents.find(({ path }) => path === 'Lore/Creation.md')
		const persistedCreation = runSync(
			parseVaultDocument(
				'Lore/Creation.md',
				await readFile(join(root, campaign.id, 'Lore', 'Creation.md'), 'utf8')
			)
		)

		expect(documents).toHaveLength(2)
		expect(creation?.id).toBeTruthy()
		expect(persistedCreation.id).toBe(creation?.id)
		expect(persistedCreation.type).toBe('lore')
		expect(await readFile(join(root, campaign.id, 'Lore', 'Creation.md'), 'utf8')).toContain(
			'tags:\n  - origin'
		)
		expect(indexedDocuments.has('stale')).toBe(false)
		expect(indexedDocuments.get(creation?.id ?? '')?.links).toEqual(['Westgate'])
		expect(indexedDocuments.get('location_westgate')).toMatchObject({
			title: 'Westgate',
			type: 'location'
		})
		expect(contextIndex.reindexCampaign).toHaveBeenCalledWith(campaign.id, documents)
	})

	it('rebuilds event precedence metadata from Markdown', async () => {
		await runPromise(
			storage.write(
				campaign.id,
				'Events/First.md',
				`---
id: event-first
type: event
---

# First`
			)
		)
		await runPromise(
			storage.write(
				campaign.id,
				'Events/Second.md',
				`---
id: event-second
type: event
after:
  - event-first
---

# Second`
			)
		)

		await runPromise(operations.reindexCampaign(campaign.id))

		expect(indexedDocuments.get('event-second')?.after).toEqual(['event-first'])
	})

	it('rejects duplicate document IDs before returning or rebuilding the index', async () => {
		const duplicate = `---
id: duplicate
---

# Duplicate`
		await runPromise(storage.write(campaign.id, 'Lore/One.md', duplicate))
		await runPromise(storage.write(campaign.id, 'Lore/Two.md', duplicate))

		const result = await runPromise(flip(operations.reindexCampaign(campaign.id)))

		expect(result).toMatchObject({
			domain: 'vault',
			operation: 'listDocuments',
			cause: { duplicateIds: ['duplicate'] }
		})
		expect(indexedDocuments.size).toBe(0)
	})
})
