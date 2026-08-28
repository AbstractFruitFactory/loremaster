import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flip, runPromise, runSync, succeed } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Campaign } from '../campaign/types'
import { filesystemVaultStorage } from './storage/filesystem'
import { parseVaultDocument } from './markdown'
import { vaultOperations } from './operations'
import type { VaultDocumentIndex } from './types'

type VaultDatabase = Parameters<typeof vaultOperations>[0]['db']

const campaign: Campaign = {
	id: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
	name: 'Curse of Blackwood',
	description: 'A gothic campaign.',
	createdAt: '2026-08-28T00:00:00.000Z'
}

describe('vault operations', () => {
	let root: string
	let indexedDocuments: Map<string, VaultDocumentIndex>
	let operations: ReturnType<typeof vaultOperations>
	let storage: ReturnType<typeof filesystemVaultStorage>

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'loremaster-vault-'))
		indexedDocuments = new Map()
		storage = filesystemVaultStorage(root)

		const db: VaultDatabase = {
			getCampaignById: () => succeed(campaign),
			getDocumentPath: (_campaignId, documentId) => succeed(indexedDocuments.get(documentId)?.path),
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

		operations = vaultOperations({ db, storage })
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
				type: 'character',
				aliases: ['Varek the Innkeeper'],
				content: '# Varek\n\nLives in [[Westgate]].'
			})
		)
		const loaded = await runPromise(operations.getDocument(campaign.id, created.id))
		const [listed] = await runPromise(operations.listDocuments(campaign.id))

		expect(loaded).toEqual(created)
		expect(listed).not.toHaveProperty('content')
		expect(indexedDocuments.get(created.id)).toEqual({
			id: created.id,
			path: 'Characters/Varek.md',
			title: 'Varek',
			type: 'character',
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

	it('loads an indexed document without listing the vault', async () => {
		const created = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				content: '# Varek'
			})
		)
		const list = vi.spyOn(storage, 'list')

		const loaded = await runPromise(operations.getDocument(campaign.id, created.id))

		expect(loaded).toEqual(created)
		expect(list).not.toHaveBeenCalled()
	})

	it('replaces indexed links when a document changes', async () => {
		const created = await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				content: '# Varek\n\nLives in [[Westgate]].'
			})
		)

		await runPromise(
			operations.updateDocument(campaign.id, created.id, {
				content: '# Varek\n\nWorks with [[Ashen Council|the council]].'
			})
		)

		expect(indexedDocuments.get(created.id)?.links).toEqual(['Ashen Council'])
	})

	it('does not overwrite an existing document path', async () => {
		await runPromise(
			operations.createDocument(campaign.id, {
				path: 'Characters/Varek.md',
				content: '# Varek'
			})
		)

		const result = await runPromise(
			flip(
				operations.createDocument(campaign.id, {
					path: 'Characters/Varek.md',
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
		expect(await readFile(join(root, campaign.id, 'Lore', 'Creation.md'), 'utf8')).toContain(
			'tags:\n  - origin'
		)
		expect(indexedDocuments.has('stale')).toBe(false)
		expect(indexedDocuments.get(creation?.id ?? '')?.links).toEqual(['Westgate'])
		expect(indexedDocuments.get('location_westgate')).toMatchObject({
			title: 'Westgate',
			type: 'location'
		})
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
