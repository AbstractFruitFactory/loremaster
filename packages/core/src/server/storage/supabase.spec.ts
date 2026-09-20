import { runPromise } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { VaultRevision } from '../vault/revisions/types.js'
import {
	campaignImportContentHash,
	campaignImportSourceId,
	campaignImportSourceRevisionId
} from '../ingestion/ids.js'
import { createSupabaseStorageAdapter, type SupabaseObjectStorage } from './supabase.js'

const memoryObjects = (): SupabaseObjectStorage => {
	const values = new Map<string, string>()
	const missing = (path: string) => Object.assign(Error(`Missing ${path}`), { code: 'ENOENT' })
	return {
		ensureBucket: async () => undefined,
		read: async (path) => values.get(path) ?? Promise.reject(missing(path)),
		create: async (path, content) => {
			if (values.has(path)) throw Object.assign(Error(`Existing ${path}`), { code: 'EEXIST' })
			values.set(path, content)
		},
		write: async (path, content) => {
			values.set(path, content)
		},
		delete: async (path) => {
			values.delete(path)
		},
		list: async (prefix = '') => {
			const normalizedPrefix = prefix ? `${prefix}/` : ''
			return [...values.keys()]
				.filter((path) => path.startsWith(normalizedPrefix))
				.map((path) => path.slice(normalizedPrefix.length))
				.sort()
		}
	}
}

describe('Supabase storage adapter', () => {
	it('creates, updates, lists, reads, and deletes vault documents', async () => {
		const { vault } = createSupabaseStorageAdapter(memoryObjects())
		await runPromise(vault.create('campaign-1', 'npcs/ilyra.md', 'first'))
		await runPromise(vault.write('campaign-1', 'npcs/ilyra.md', 'second'))

		expect(await runPromise(vault.list('campaign-1'))).toEqual(['npcs/ilyra.md'])
		expect(await runPromise(vault.read('campaign-1', 'npcs/ilyra.md'))).toBe('second')

		await runPromise(vault.delete('campaign-1', 'npcs/ilyra.md'))
		expect(await runPromise(vault.list('campaign-1'))).toEqual([])
	})

	it('stores deterministic revision history through the same adapter', async () => {
		const { revisions } = createSupabaseStorageAdapter(memoryObjects())
		const revision: VaultRevision = {
			schemaVersion: 1,
			revisionId: 'revision-1',
			campaignId: 'campaign-1',
			documentId: 'document-1',
			path: 'npcs/ilyra.md',
			createdAt: '2026-09-20T00:00:00.000Z',
			previousRevisionId: null,
			operation: 'create',
			source: 'manual',
			beforeHash: null,
			afterHash: 'hash',
			snapshot: 'content'
		}

		await runPromise(revisions.write(revision))
		expect(await runPromise(revisions.listDocumentRevisions('campaign-1', 'document-1'))).toEqual([
			revision
		])
		expect(await runPromise(revisions.listCampaignRevisions('campaign-1'))).toEqual([revision])
	})

	it('shares campaign import state between independently created adapters', async () => {
		const objects = memoryObjects()
		const writer = createSupabaseStorageAdapter(objects).ingestion
		const reader = createSupabaseStorageAdapter(objects).ingestion
		const campaignId = 'campaign-1'
		const ingestionId = 'import-1'
		const content = '# Imported notes'
		const sourceId = campaignImportSourceId(ingestionId, 0)
		const contentHash = campaignImportContentHash(content)
		const sourceRevisionId = campaignImportSourceRevisionId(sourceId, contentHash)
		const source = {
			displayName: 'notes.md',
			sourceId,
			sourceRevisionId,
			title: 'Imported notes',
			mediaType: 'text/markdown',
			contentHash,
			byteLength: Buffer.byteLength(content)
		}

		await runPromise(
			writer.writeCampaignImportData(
				{
					schemaVersion: 1,
					kind: 'campaign-import',
					campaignId,
					ingestionId,
					createdAt: '2026-09-20T00:00:00.000Z',
					sources: [source]
				},
				[{ ...source, content }]
			)
		)

		const lifecycle = await runPromise(
			reader.readCampaignImportLifecycleState(campaignId, ingestionId)
		)
		expect(lifecycle.request.ingestionId).toBe(ingestionId)
		expect(await runPromise(reader.listCampaignImports(campaignId))).toMatchObject([
			{ campaignId, ingestionId, phase: 'analyzing' }
		])
	})
})
