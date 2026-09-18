import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	ensuring,
	fail,
	flatMap,
	flip,
	promise,
	runPromise,
	succeed,
	suspend,
	sync,
	type Effect
} from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Failure } from '../../failure.js'
import {
	withAdvisoryLocks as withReservedAdvisoryLocks,
	type AdvisoryLockConnection
} from '../../db/advisory-lock.js'
import { filesystemVaultStorage } from '../storage/filesystem.js'
import { vaultRevision } from './index.js'
import { filesystemRevisionStorage, type RevisionStorage } from './storage.js'
import type { RevisionHead, VaultRevision } from './types.js'

const campaignId = 'campaign-1'
const documentId = 'document-1'
const path = 'NPCs/Varek.md'
const revisionId = '11111111-1111-5111-8111-111111111111'
const source = '---\nid: document-1\ntype: npc\n---\n\n# Varek'

type AdvisoryLocks = <Value, Error, Requirements>(
	keys: readonly string[],
	effect: () => Effect<Value, Error, Requirements>
) => Effect<Value, Error | Failure, Requirements>

const passthroughAdvisoryLocks: AdvisoryLocks = (_keys, effect) => effect()

const sharedAdvisoryLocks = (): AdvisoryLocks => {
	const locks = new Map<string, Promise<void>>()
	const withLock = <Value, Error, Requirements>(
		key: string,
		effect: () => Effect<Value, Error, Requirements>
	): Effect<Value, Error, Requirements> =>
		suspend(() => {
			const previous = locks.get(key) ?? Promise.resolve()
			let release = () => {}
			const gate = new Promise<void>((resolve) => {
				release = resolve
			})
			const queued = previous.then(() => gate)
			locks.set(key, queued)
			return flatMap(
				promise(() => previous),
				() =>
					ensuring(
						effect(),
						sync(() => {
							release()
							if (locks.get(key) === queued) locks.delete(key)
						})
					)
			)
		})
	return (keys, effect) =>
		[...new Set(keys)].sort().reduceRight((next, key) => () => withLock(key, next), effect)()
}

const boundedPool = (capacity: number) => {
	let active = 0
	let maximumActive = 0
	let acquisitions = 0
	const waiters: Array<() => void> = []
	return {
		acquire: async () => {
			if (active >= capacity) {
				await new Promise<void>((resolve) => {
					waiters.push(resolve)
				})
			}
			active++
			acquisitions++
			maximumActive = Math.max(maximumActive, active)
			let released = false
			return () => {
				if (released) return
				released = true
				active--
				waiters.shift()?.()
			}
		},
		stats: () => ({ active, maximumActive, acquisitions })
	}
}

describe('resumable vault revisions', () => {
	let root: string
	let heads: Map<string, RevisionHead>
	let indexed: VaultRevision[]
	let revisionStorage: ReturnType<typeof filesystemRevisionStorage>
	let vaultStorage: ReturnType<typeof filesystemVaultStorage>

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'loremaster-revision-recovery-'))
		heads = new Map()
		indexed = []
		revisionStorage = filesystemRevisionStorage(root)
		vaultStorage = filesystemVaultStorage(root)
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	const operations = ({
		revisions = revisionStorage,
		failIndex = () => false,
		withAdvisoryLocks = passthroughAdvisoryLocks,
		beforeIndex = () => succeed(undefined)
	}: {
		revisions?: RevisionStorage
		failIndex?: () => boolean
		withAdvisoryLocks?: AdvisoryLocks
		beforeIndex?: () => Effect<void, never>
	} = {}) =>
		vaultRevision({
			db: {
				withAdvisoryLocks,
				getRevisionHead: (_campaignId, id) => succeed(heads.get(id)),
				indexRevision: (revision) =>
					flatMap(beforeIndex(), () => {
						if (failIndex()) {
							return fail({
								domain: 'database',
								operation: 'indexVaultRevision',
								cause: new Error('injected revision index failure')
							})
						}
						const head = heads.get(revision.documentId)
						if (
							head &&
							head.revisionId !== revision.revisionId &&
							head.revisionId !== revision.previousRevisionId
						) {
							return fail({
								domain: 'database',
								operation: 'indexVaultRevision',
								cause: new Error('stale revision head')
							})
						}
						if (!indexed.some(({ revisionId: id }) => id === revision.revisionId)) {
							indexed.push(revision)
						}
						heads.set(revision.documentId, {
							campaignId: revision.campaignId,
							documentId: revision.documentId,
							revisionId: revision.revisionId,
							path: revision.path,
							sourceHash: revision.afterHash
						})
						return succeed(undefined)
					}),
				replaceCampaignRevisionIndex: () => succeed(undefined)
			},
			revisions,
			vault: vaultStorage
		})

	it('recovers after the canonical write and before the revision file', async () => {
		let failWrite = true
		const revisions: RevisionStorage = {
			...revisionStorage,
			write: (revision) => {
				if (failWrite) {
					failWrite = false
					return fail({
						domain: 'revisionStorage',
						operation: 'writeRevision',
						cause: new Error('injected revision file failure')
					})
				}
				return revisionStorage.write(revision)
			}
		}
		const service = operations({ revisions })

		await runPromise(flip(service.create(campaignId, documentId, path, source, { revisionId })))
		expect(await runPromise(vaultStorage.read(campaignId, path))).toBe(source)

		const recovered = await runPromise(
			service.create(campaignId, documentId, path, source, { revisionId })
		)

		expect(recovered.revisionId).toBe(revisionId)
		expect(indexed).toHaveLength(1)
	})

	it('recovers after the revision file and before revision DB indexing', async () => {
		let failIndex = true
		const service = operations({
			failIndex: () => {
				if (!failIndex) return false
				failIndex = false
				return true
			}
		})

		await runPromise(flip(service.create(campaignId, documentId, path, source, { revisionId })))
		expect(
			await runPromise(revisionStorage.getRevision(campaignId, documentId, revisionId))
		).toMatchObject({
			revisionId,
			snapshot: source
		})

		const recovered = await runPromise(
			service.create(campaignId, documentId, path, source, { revisionId })
		)

		expect(recovered.revisionId).toBe(revisionId)
		expect(heads.get(documentId)?.revisionId).toBe(revisionId)
		expect(indexed).toHaveLength(1)
	})

	it('keeps deterministic revision files immutable', async () => {
		const revision: VaultRevision = {
			schemaVersion: 1,
			revisionId,
			previousRevisionId: null,
			campaignId,
			documentId,
			path,
			operation: 'create',
			source: 'ingestion',
			createdAt: '2026-09-17T00:00:00.000Z',
			beforeHash: null,
			afterHash: 'hash',
			snapshot: source
		}
		await runPromise(revisionStorage.write(revision))
		const existing = await runPromise(
			revisionStorage.write({ ...revision, createdAt: '2026-09-18T00:00:00.000Z' })
		)
		const failure = await runPromise(
			flip(revisionStorage.write({ ...revision, snapshot: 'different' }))
		)

		expect(existing.createdAt).toBe(revision.createdAt)
		expect(failure).toMatchObject({
			domain: 'revisionStorage',
			operation: 'writeRevision'
		})
	})

	it('does not replace an unrelated newer revision head', async () => {
		const service = operations()
		await runPromise(service.create(campaignId, documentId, path, source, { revisionId }))
		heads.set(documentId, {
			campaignId,
			documentId,
			revisionId: '22222222-2222-5222-8222-222222222222',
			path,
			sourceHash: 'manual'
		})

		const failure = await runPromise(
			flip(service.create(campaignId, documentId, path, source, { revisionId }))
		)

		expect(failure).toMatchObject({
			domain: 'vaultRevision',
			operation: 'verifyBase',
			cause: { reason: 'revisionMismatch' }
		})
	})

	it('serializes stale updates across independent revision services', async () => {
		const withAdvisoryLocks = sharedAdvisoryLocks()
		const firstService = operations({ withAdvisoryLocks })
		const secondService = operations({ withAdvisoryLocks })
		await runPromise(firstService.create(campaignId, documentId, path, source, { revisionId }))

		const firstRevisionId = '22222222-2222-5222-8222-222222222222'
		const secondRevisionId = '33333333-3333-5333-8333-333333333333'
		const results = await Promise.allSettled([
			runPromise(
				firstService.update(campaignId, documentId, path, source, `${source}\n\nFirst`, {
					expectedRevisionId: revisionId,
					revisionId: firstRevisionId
				})
			),
			runPromise(
				secondService.update(campaignId, documentId, path, source, `${source}\n\nSecond`, {
					expectedRevisionId: revisionId,
					revisionId: secondRevisionId
				})
			)
		])

		const successful = results.filter(
			(result): result is PromiseFulfilledResult<VaultRevision> => result.status === 'fulfilled'
		)
		expect(successful).toHaveLength(1)
		expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
		expect(await runPromise(vaultStorage.read(campaignId, path))).toBe(
			successful[0]?.value.snapshot
		)
		expect(heads.get(documentId)?.revisionId).toBe(successful[0]?.value.revisionId)
		expect(heads.get(documentId)?.sourceHash).toBe(successful[0]?.value.afterHash)
	})

	it('keeps query capacity available during concurrent creates', async () => {
		const lockPool = boundedPool(2)
		const queryPool = boundedPool(1)
		let lockCalls = 0
		const withAdvisoryLocks: AdvisoryLocks = (keys, effect) =>
			withReservedAdvisoryLocks(
				async (): Promise<AdvisoryLockConnection> => {
					const release = await lockPool.acquire()
					return {
						lock: async () => {
							lockCalls++
						},
						unlock: async () => {},
						release
					}
				},
				keys,
				effect
			)
		const beforeIndex = () =>
			promise(async () => {
				const release = await queryPool.acquire()
				try {
					await new Promise<void>((resolve) => setImmediate(resolve))
				} finally {
					release()
				}
			})
		const creates = Array.from({ length: 4 }, (_, index) => {
			const service = operations({ withAdvisoryLocks, beforeIndex })
			return runPromise(
				service.create(
					campaignId,
					`document-${index}`,
					`NPCs/Character-${index}.md`,
					`${source}\n\n${index}`,
					{ revisionId: `revision-${index}` }
				)
			)
		})
		let timeout: NodeJS.Timeout | undefined
		try {
			await Promise.race([
				Promise.all(creates),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('concurrent creates timed out')), 1000)
				})
			])
		} finally {
			if (timeout) clearTimeout(timeout)
		}

		expect(lockPool.stats()).toEqual({
			active: 0,
			maximumActive: 2,
			acquisitions: 4
		})
		expect(queryPool.stats()).toEqual({
			active: 0,
			maximumActive: 1,
			acquisitions: 4
		})
		expect(lockCalls).toBe(8)
	})
})
