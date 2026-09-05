import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fail as failEffect, flip, runPromise, succeed } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filesystemVaultStorage } from '../storage/filesystem'
import { sourceHash, vaultRevisionOperations } from './operations'
import { filesystemRevisionStorage } from './storage'
import type { RevisionHead, RevisionTransactionManifest, VaultRevision } from './types'

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
					heads = new Map(
						revisions.map((revision) => [
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

	it('stores resulting snapshots and follows create, update, delete, and restore chains', async () => {
		const firstSource = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		const secondSource = `${firstSource}\n\nGuards the gate.`
		const created = await runPromise(operations.create(campaignId, documentId, path, firstSource))
		const updated = await runPromise(
			operations.update(campaignId, documentId, path, firstSource, secondSource, {
				expectedSourceHash: sourceHash(firstSource),
				expectedRevisionId: created.revisionId
			})
		)
		const deleted = await runPromise(
			operations.delete(campaignId, documentId, path, secondSource, {
				expectedSourceHash: sourceHash(secondSource),
				expectedRevisionId: updated.revisionId
			})
		)
		const restored = await runPromise(
			operations.restore(campaignId, documentId, created.revisionId, {
				expectedSourceHash: null,
				expectedRevisionId: deleted.revisionId
			})
		)
		const history = await runPromise(operations.listRevisions(campaignId, documentId))
		const deletedRevision = await runPromise(
			operations.getRevision(campaignId, documentId, deleted.revisionId)
		)

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
		expect(history.every((revision) => !('snapshot' in revision))).toBe(true)
		expect(history.map(({ hasSnapshot }) => hasSnapshot)).toEqual([true, true, false, true])
		expect(deletedRevision.snapshot).toBeNull()
		expect(restored.snapshot).toBe(firstSource)
		expect(await runPromise(vault.read(campaignId, path))).toBe(firstSource)
	})

	it('aborts a prepared transaction when the canonical write fails', async () => {
		const source = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		const created = await runPromise(operations.create(campaignId, documentId, path, source))
		vi.spyOn(vault, 'write').mockImplementationOnce(() =>
			failEffect({
				domain: 'vaultStorage',
				operation: 'writeDocument'
			})
		)

		const failure = await runPromise(
			flip(
				operations.update(campaignId, documentId, path, source, `${source}\nChanged`, {
					expectedSourceHash: sourceHash(source),
					expectedRevisionId: created.revisionId
				})
			)
		)

		expect(failure).toMatchObject({
			domain: 'vaultStorage',
			operation: 'writeDocument'
		})
		expect(await runPromise(operations.listRevisions(campaignId, documentId))).toHaveLength(1)
		expect(await runPromise(vault.read(campaignId, path))).toBe(source)
		const manifests = await runPromise(storage.listTransactions(campaignId))
		const failed = manifests.find(({ transactionId }) => transactionId !== created.transactionId)
		expect(failed).toBeDefined()
		expect(await runPromise(storage.getTransactionStatus(campaignId, failed!.transactionId))).toBe(
			'aborted'
		)
	})

	it('rejects stale source hashes and revision IDs before staging', async () => {
		const source = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		const created = await runPromise(operations.create(campaignId, documentId, path, source))

		const hashFailure = await runPromise(
			flip(
				operations.update(campaignId, documentId, path, source, `${source}\nChanged`, {
					expectedSourceHash: sourceHash('stale'),
					expectedRevisionId: created.revisionId
				})
			)
		)
		const revisionFailure = await runPromise(
			flip(
				operations.delete(campaignId, documentId, path, source, {
					expectedSourceHash: sourceHash(source),
					expectedRevisionId: 'stale-revision'
				})
			)
		)

		expect(hashFailure).toMatchObject({
			domain: 'vaultRevision',
			operation: 'verifyBase',
			cause: { reason: 'sourceHashMismatch' }
		})
		expect(revisionFailure).toMatchObject({
			domain: 'vaultRevision',
			operation: 'verifyBase',
			cause: { reason: 'revisionMismatch' }
		})
		expect(await runPromise(operations.listRevisions(campaignId, documentId))).toHaveLength(1)
	})

	it('records out-of-band source drift as an import revision', async () => {
		const source = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		const drifted = `${source}\n\nEdited outside Loremaster.`
		const created = await runPromise(operations.create(campaignId, documentId, path, source))
		await runPromise(vault.write(campaignId, path, drifted))

		const importedHead = await runPromise(
			operations.ensureCurrentRevision(campaignId, documentId, path, drifted)
		)
		const history = await runPromise(operations.listRevisions(campaignId, documentId))
		const imported = await runPromise(
			operations.getRevision(campaignId, documentId, importedHead.revisionId)
		)

		expect(history.at(-1)).toMatchObject({
			operation: 'import',
			previousRevisionId: created.revisionId,
			beforeHash: sourceHash(source),
			afterHash: sourceHash(drifted),
			hasSnapshot: true
		})
		expect(imported.snapshot).toBe(drifted)
		expect(importedHead.sourceHash).toBe(sourceHash(drifted))
	})

	it('records an out-of-band deletion before returning history', async () => {
		const source = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		await runPromise(operations.create(campaignId, documentId, path, source))
		await runPromise(vault.delete(campaignId, path))

		const history = await runPromise(operations.listRevisions(campaignId, documentId))
		const tombstone = await runPromise(
			operations.getRevision(campaignId, documentId, history.at(-1)!.revisionId)
		)

		expect(history.map(({ operation }) => operation)).toEqual(['create', 'import'])
		expect(history.at(-1)?.hasSnapshot).toBe(false)
		expect(tombstone).toMatchObject({ operation: 'import', afterHash: null, snapshot: null })
	})

	it('serializes concurrent writes so only one expected-head mutation commits', async () => {
		const source = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		const created = await runPromise(operations.create(campaignId, documentId, path, source))

		const results = await Promise.allSettled([
			runPromise(
				operations.update(campaignId, documentId, path, source, `${source}\nFirst`, {
					expectedSourceHash: sourceHash(source),
					expectedRevisionId: created.revisionId
				})
			),
			runPromise(
				operations.update(campaignId, documentId, path, source, `${source}\nSecond`, {
					expectedSourceHash: sourceHash(source),
					expectedRevisionId: created.revisionId
				})
			)
		])

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
		expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
		expect(await runPromise(operations.listRevisions(campaignId, documentId))).toHaveLength(2)
	})

	it('generates a line diff against the preceding resulting snapshot', async () => {
		const first = await runPromise(
			operations.create(campaignId, documentId, path, 'one\ntwo\nthree')
		)
		const second = await runPromise(
			operations.update(campaignId, documentId, path, first.snapshot!, 'one\nchanged\nthree', {
				expectedSourceHash: first.afterHash!,
				expectedRevisionId: first.revisionId
			})
		)

		const diff = await runPromise(
			operations.diffRevisions(campaignId, documentId, second.revisionId)
		)

		expect(diff).toEqual({
			fromRevisionId: first.revisionId,
			toRevisionId: second.revisionId,
			hunks: [
				{
					oldStart: 1,
					newStart: 1,
					lines: [
						{ type: 'context', line: 'one' },
						{ type: 'removed', line: 'two' },
						{ type: 'added', line: 'changed' },
						{ type: 'context', line: 'three' }
					]
				}
			],
			truncated: false,
			omittedLineCount: 0
		})
	})

	it('bounds large diff responses and reports omitted rows', async () => {
		const before = Array.from({ length: 1000 }, (_, index) => `before-${index}`).join('\n')
		const after = Array.from({ length: 1000 }, (_, index) => `after-${index}`).join('\n')
		const first = await runPromise(operations.create(campaignId, documentId, path, before))
		const second = await runPromise(
			operations.update(campaignId, documentId, path, before, after, {
				expectedSourceHash: sourceHash(before),
				expectedRevisionId: first.revisionId
			})
		)

		const diff = await runPromise(
			operations.diffRevisions(campaignId, documentId, second.revisionId)
		)

		expect(diff.truncated).toBe(true)
		expect(diff.omittedLineCount).toBe(1600)
		expect(diff.hunks[0].lines).toHaveLength(400)
	})

	it('keeps prepared revisions hidden and aborts recovery when canon is still before', async () => {
		const before = 'before'
		const after = 'after'
		await runPromise(vault.create(campaignId, path, before))
		const { manifest, revision } = transaction('prepared-before', before, after)
		await runPromise(storage.prepare(manifest, revision))

		expect(await runPromise(storage.listDocumentRevisions(campaignId, documentId))).toEqual([])
		expect(await runPromise(operations.recoverCampaign(campaignId))).toEqual([
			{ transactionId: manifest.transactionId, status: 'aborted' }
		])
		expect(await runPromise(storage.getTransactionStatus(campaignId, manifest.transactionId))).toBe(
			'aborted'
		)
	})

	it('completes recovery after canon write or revision promotion', async () => {
		for (const promoted of [false, true]) {
			const transactionId = promoted ? 'after-promoted' : 'after-canon'
			const before = `before-${transactionId}`
			const after = `after-${transactionId}`
			const transactionPath = `Lore/${transactionId}.md`
			await runPromise(vault.create(campaignId, transactionPath, before))
			const { manifest, revision } = transaction(
				transactionId,
				before,
				after,
				transactionPath,
				`${documentId}-${transactionId}`
			)
			await runPromise(storage.prepare(manifest, revision))
			await runPromise(vault.write(campaignId, transactionPath, after))
			await runPromise(storage.markCanonCommitted(campaignId, transactionId))
			if (promoted) await runPromise(storage.promote(campaignId, transactionId))
		}

		const results = await runPromise(operations.recoverCampaign(campaignId))

		expect(results.map(({ status }) => status)).toEqual(['committed', 'committed'])
		expect(indexed).toHaveLength(2)
	})

	it('re-indexes a transaction already carrying its committed marker', async () => {
		const source = 'source'
		const created = await runPromise(operations.create(campaignId, documentId, path, source))
		heads.clear()
		indexed = []

		const results = await runPromise(operations.recoverCampaign(campaignId))

		expect(results).toContainEqual({
			transactionId: created.transactionId,
			status: 'committed'
		})
		expect(heads.get(documentId)?.revisionId).toBe(created.revisionId)
	})

	it('runs lazy campaign recovery only once before ordinary revision reads', async () => {
		const listTransactions = vi.spyOn(storage, 'listTransactions')
		await runPromise(operations.listRevisions(campaignId, documentId))
		await runPromise(operations.listRevisions(campaignId, documentId))

		expect(listTransactions).toHaveBeenCalledTimes(1)
	})

	it('marks unexpected recovery state conflicted without modifying or promoting it', async () => {
		await runPromise(vault.create(campaignId, path, 'before'))
		const { manifest, revision } = transaction('third-state', 'before', 'after')
		await runPromise(storage.prepare(manifest, revision))
		await runPromise(vault.write(campaignId, path, 'unexpected'))

		expect(await runPromise(operations.recoverCampaign(campaignId))).toEqual([
			{ transactionId: manifest.transactionId, status: 'conflicted' }
		])
		expect(await runPromise(vault.read(campaignId, path))).toBe('unexpected')
		expect(await runPromise(storage.listDocumentRevisions(campaignId, documentId))).toEqual([])
	})

	it('rebuilds derived heads from committed revision files', async () => {
		const source = 'source'
		const created = await runPromise(operations.create(campaignId, documentId, path, source))
		heads.clear()
		indexed = []

		const rebuilt = await runPromise(operations.rebuildIndex(campaignId))

		expect(rebuilt).toHaveLength(1)
		expect(heads.get(documentId)?.revisionId).toBe(created.revisionId)
	})

	it('fails history loading when a document has multiple committed tips', async () => {
		for (const transactionId of ['branch-one', 'branch-two']) {
			const { manifest, revision } = transaction(transactionId, null, `source-${transactionId}`)
			await runPromise(storage.prepare(manifest, revision))
			await runPromise(storage.promote(campaignId, transactionId))
			await runPromise(storage.markCommitted(campaignId, transactionId))
		}

		const failure = await runPromise(flip(storage.listDocumentRevisions(campaignId, documentId)))

		expect(failure).toMatchObject({
			domain: 'revisionStorage',
			operation: 'listDocumentRevisions'
		})
		expect((failure.cause as Error).message).toContain('2 tips')
	})

	it('never replaces an existing immutable revision during promotion', async () => {
		const first = transaction('first-promotion', null, 'first')
		await runPromise(storage.prepare(first.manifest, first.revision))
		await runPromise(storage.promote(campaignId, first.manifest.transactionId))

		const second = transaction('second-promotion', null, 'second')
		second.manifest.revisionId = first.manifest.revisionId
		second.revision.revisionId = first.revision.revisionId
		await runPromise(storage.prepare(second.manifest, second.revision))
		const failure = await runPromise(
			flip(storage.promote(campaignId, second.manifest.transactionId))
		)

		expect(failure).toMatchObject({
			domain: 'revisionStorage',
			operation: 'promoteRevision'
		})
		expect((failure.cause as Error).message).toContain('different content')
	})

	it('restores snapshots to the current head path', async () => {
		const source = '---\nid: document-varek\ntype: npc\n---\n\n# Varek'
		const created = await runPromise(operations.create(campaignId, documentId, path, source))
		const currentPath = 'Characters/Renamed Varek.md'
		await runPromise(vault.delete(campaignId, path))
		await runPromise(vault.create(campaignId, currentPath, source))
		const moved = await runPromise(
			operations.importSnapshot(campaignId, documentId, currentPath, source)
		)
		await runPromise(
			operations.restore(campaignId, documentId, created.revisionId, {
				expectedSourceHash: sourceHash(source),
				expectedRevisionId: moved.revisionId
			})
		)

		expect(await runPromise(vault.read(campaignId, currentPath))).toBe(source)
		const missing = await runPromise(flip(vault.read(campaignId, path)))
		expect(missing).toMatchObject({
			domain: 'vaultStorage'
		})
	})

	it('excludes campaign metadata from ordinary Markdown discovery', async () => {
		await runPromise(vault.write(campaignId, '.loremaster/internal.md', 'hidden'))
		await runPromise(vault.write(campaignId, 'Lore/visible.md', 'visible'))

		expect(await runPromise(vault.list(campaignId))).toEqual(['Lore/visible.md'])
	})
})

const transaction = (
	transactionId: string,
	before: string | null,
	after: string | null,
	documentPath = path,
	id = documentId
): { manifest: RevisionTransactionManifest; revision: VaultRevision } => {
	const revisionId = `revision-${transactionId}`
	const manifest: RevisionTransactionManifest = {
		schemaVersion: 1,
		transactionId,
		campaignId,
		documentId: id,
		path: documentPath,
		revisionId,
		beforeHash: before === null ? null : sourceHash(before),
		afterHash: after === null ? null : sourceHash(after)
	}
	return {
		manifest,
		revision: {
			schemaVersion: 1,
			revisionId,
			previousRevisionId: null,
			transactionId,
			campaignId,
			documentId: id,
			path: documentPath,
			operation: 'update',
			source: 'manual',
			createdAt: new Date().toISOString(),
			beforeHash: manifest.beforeHash,
			afterHash: manifest.afterHash,
			snapshot: after
		}
	}
}
