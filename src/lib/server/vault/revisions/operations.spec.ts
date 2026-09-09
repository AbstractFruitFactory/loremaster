import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flip, runPromise, succeed } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { filesystemVaultStorage } from '../storage/filesystem'
import { sourceHash, vaultRevisionOperations } from './operations'
import { filesystemRevisionStorage } from './storage'
import type { RevisionHead, VaultRevision } from './types'

const campaignId = '17ea64a7-98e4-40de-ae5f-b8e35688e157'
const documentId = 'document-varek'
const path = 'Characters/Varek.md'

describe('vault revision operations', () => {
	let root: string
	let heads: Map<string, RevisionHead>
	let indexed: VaultRevision[]
	let storage: ReturnType<typeof filesystemRevisionStorage>
	let vault: ReturnType<typeof filesystemVaultStorage>
	let operations: ReturnType<typeof vaultRevisionOperations>

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'loremaster-revisions-'))
		heads = new Map()
		indexed = []
		storage = filesystemRevisionStorage(root)
		vault = filesystemVaultStorage(root)
		operations = vaultRevisionOperations({
			db: {
				getRevisionHead: (_campaignId, id) => succeed(heads.get(id)),
				indexRevision: (revision) => {
					indexed.push(revision)
					heads.set(revision.documentId, {
						campaignId: revision.campaignId,
						documentId: revision.documentId,
						revisionId: revision.revisionId,
						path: revision.path,
						sourceHash: revision.afterHash
					})
					return succeed(undefined)
				},
				replaceCampaignRevisionIndex: (_campaignId, revisions) => {
					indexed = [...revisions]
					const referenced = new Set(
						revisions.flatMap(({ previousRevisionId }) =>
							previousRevisionId ? [previousRevisionId] : []
						)
					)
					heads = new Map(
						revisions
							.filter(({ revisionId }) => !referenced.has(revisionId))
							.map((revision) => [
								revision.documentId,
								{
									campaignId: revision.campaignId,
									documentId: revision.documentId,
									revisionId: revision.revisionId,
									path: revision.path,
									sourceHash: revision.afterHash
								}
							])
					)
					return succeed(undefined)
				}
			},
			revisions: storage,
			vault
		})
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it('stores snapshots through create, update, delete, and restore', async () => {
		const firstSource = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		const secondSource = `${firstSource}\n\nGuards the gate.`
		const created = await runPromise(operations.create(campaignId, documentId, path, firstSource))
		const updated = await runPromise(
			operations.update(campaignId, documentId, path, firstSource, secondSource, {
				expectedRevisionId: created.revisionId
			})
		)
		const deleted = await runPromise(
			operations.delete(campaignId, documentId, path, secondSource, {
				expectedRevisionId: updated.revisionId
			})
		)
		const restored = await runPromise(
			operations.restore(campaignId, documentId, created.revisionId, {
				expectedRevisionId: deleted.revisionId
			})
		)
		const history = await runPromise(operations.listRevisions(campaignId, documentId))

		expect(history.map(({ operation }) => operation)).toEqual([
			'create',
			'update',
			'delete',
			'restore'
		])
		expect(history.map(({ previousRevisionId }) => previousRevisionId)).toEqual([
			null,
			created.revisionId,
			updated.revisionId,
			deleted.revisionId
		])
		expect(history.map(({ hasSnapshot }) => hasSnapshot)).toEqual([true, true, false, true])
		expect(restored.snapshot).toBe(firstSource)
		expect(await runPromise(vault.read(campaignId, path))).toBe(firstSource)
	})

	it('records ingestion context on created and updated revisions', async () => {
		const created = await runPromise(
			operations.create(campaignId, documentId, path, 'first', {
				source: 'ingestion',
				relatedSessionId: 'session-document',
				ingestionId: 'ingestion-draft',
				changeSummary: 'Created from Session 12'
			})
		)
		const updated = await runPromise(
			operations.update(campaignId, documentId, path, 'first', 'second', {
				expectedRevisionId: created.revisionId,
				source: 'ingestion',
				relatedSessionId: 'session-document',
				ingestionId: 'ingestion-draft',
				changeSummary: 'Updated from Session 12'
			})
		)

		expect(created).toMatchObject({
			source: 'ingestion',
			relatedSessionId: 'session-document',
			ingestionId: 'ingestion-draft',
			changeSummary: 'Created from Session 12'
		})
		expect(updated).toMatchObject({
			source: 'ingestion',
			relatedSessionId: 'session-document',
			ingestionId: 'ingestion-draft',
			changeSummary: 'Updated from Session 12'
		})
	})

	it('rejects stale UI revisions', async () => {
		const source = 'initial'
		const created = await runPromise(operations.create(campaignId, documentId, path, source))
		await runPromise(
			operations.update(campaignId, documentId, path, source, 'current', {
				expectedRevisionId: created.revisionId
			})
		)
		const error = await runPromise(
			flip(
				operations.update(campaignId, documentId, path, source, 'stale', {
					expectedRevisionId: created.revisionId
				})
			)
		)
		expect(error).toMatchObject({
			domain: 'vaultRevision',
			operation: 'verifyBase',
			cause: { reason: 'revisionMismatch' }
		})
	})

	it('rejects unexpected canonical changes but records explicit imports', async () => {
		const created = await runPromise(operations.create(campaignId, documentId, path, 'original'))
		await runPromise(vault.write(campaignId, path, 'external'))
		const error = await runPromise(
			flip(operations.verifyCurrentRevision(campaignId, documentId, path, 'external'))
		)
		expect(error).toMatchObject({
			domain: 'vaultRevision',
			operation: 'verifyCanon',
			cause: { reason: 'canonicalHashMismatch' }
		})
		const imported = await runPromise(
			operations.importSnapshot(campaignId, documentId, path, 'external')
		)
		expect(imported).toMatchObject({
			operation: 'import',
			previousRevisionId: created.revisionId,
			beforeHash: sourceHash('original'),
			afterHash: sourceHash('external'),
			snapshot: 'external'
		})
	})

	it('generates diffs and can rebuild the metadata index', async () => {
		const created = await runPromise(operations.create(campaignId, documentId, path, 'one'))
		const updated = await runPromise(
			operations.update(campaignId, documentId, path, 'one', 'two', {
				expectedRevisionId: created.revisionId
			})
		)
		const diff = await runPromise(
			operations.diffRevisions(campaignId, documentId, updated.revisionId)
		)
		expect(diff.hunks[0]?.lines).toEqual([
			{ type: 'removed', line: 'one' },
			{ type: 'added', line: 'two' }
		])
		heads.clear()
		await runPromise(operations.rebuildIndex(campaignId))
		expect(heads.get(documentId)?.revisionId).toBe(updated.revisionId)
	})

	it('excludes campaign metadata from Markdown discovery', async () => {
		await runPromise(vault.write(campaignId, '.loremaster/internal.md', 'hidden'))
		await runPromise(vault.write(campaignId, 'Lore/visible.md', 'visible'))
		expect(await runPromise(vault.list(campaignId))).toEqual(['Lore/visible.md'])
	})
})
