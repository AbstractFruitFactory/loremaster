import { createHash, randomUUID } from 'node:crypto'
import {
	all,
	catchAll,
	ensuring,
	fail as failEffect,
	flatMap,
	gen,
	map,
	promise,
	succeed,
	suspend,
	sync,
	type Effect
} from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { Failure } from '../../failure'
import type { VaultStorage } from '../storage/storage'
import type { RevisionStorage } from './storage'
import type {
	RecoveryResult,
	RevisionDiff,
	RevisionHead,
	RevisionOperation,
	RevisionSource,
	RevisionTransactionManifest,
	VaultRevision,
	VaultRevisionMetadata
} from './types'

export const sourceHash = (source: string) =>
	createHash('sha256').update(source, 'utf8').digest('hex')

type RevisionDb = {
	getRevisionHead: (
		campaignId: string,
		documentId: string
	) => Effect<RevisionHead | undefined, Failure>
	indexRevision: (revision: VaultRevision) => Effect<void, Failure>
	replaceCampaignRevisionIndex: (
		campaignId: string,
		revisions: VaultRevision[]
	) => Effect<void, Failure>
}

type MutationInput = {
	campaignId: string
	documentId: string
	path: string
	operation: RevisionOperation
	source: RevisionSource
	beforeSource: string | null
	afterSource: string | null
	beforeHashOverride?: string | null
	expectedCurrentHashOverride?: string | null
	previousRevisionId: string | null
	relatedSessionId?: string
	ingestionId?: string
	changeSummary?: string
}

const isMissing = (failure: Failure) =>
	failure.cause instanceof Error &&
	'code' in failure.cause &&
	(failure.cause as NodeJS.ErrnoException).code === 'ENOENT'

const DIFF_CONTEXT_LINES = 3
const MAX_DIFF_ROWS = 400

const lineDiff = (before: string, after: string): RevisionDiff => {
	const left = before.split('\n')
	const right = after.split('\n')
	let prefix = 0
	while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++

	let suffix = 0
	while (
		suffix < left.length - prefix &&
		suffix < right.length - prefix &&
		left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
	) {
		suffix++
	}

	const contextBeforeStart = Math.max(0, prefix - DIFF_CONTEXT_LINES)
	const contextAfterCount = Math.min(DIFF_CONTEXT_LINES, suffix)
	const rows = [
		...left.slice(contextBeforeStart, prefix).map((line) => ({ type: 'context' as const, line })),
		...left.slice(prefix, left.length - suffix).map((line) => ({ type: 'removed' as const, line })),
		...right.slice(prefix, right.length - suffix).map((line) => ({ type: 'added' as const, line })),
		...right
			.slice(right.length - suffix, right.length - suffix + contextAfterCount)
			.map((line) => ({ type: 'context' as const, line }))
	]
	const omittedLineCount = Math.max(0, rows.length - MAX_DIFF_ROWS)
	const lines =
		omittedLineCount === 0
			? rows
			: [...rows.slice(0, MAX_DIFF_ROWS / 2), ...rows.slice(rows.length - MAX_DIFF_ROWS / 2)]
	return {
		fromRevisionId: null,
		toRevisionId: '',
		hunks: lines.length
			? [{ oldStart: contextBeforeStart + 1, newStart: contextBeforeStart + 1, lines }]
			: [],
		truncated: omittedLineCount > 0,
		omittedLineCount
	}
}

export const vaultRevisionOperations = ({
	db,
	revisions,
	vault
}: {
	db: RevisionDb
	revisions: RevisionStorage
	vault: VaultStorage
}) => {
	const locks = new Map<string, Promise<void>>()
	const recoveredCampaigns = new Set<string>()

	const withLock = <Value, Error, Requirements>(
		key: string,
		effect: () => Effect<Value, Error, Requirements>
	): Effect<Value, Error, Requirements> =>
		suspend(() => {
			const previous = locks.get(key) ?? Promise.resolve()
			let release = () => {}
			const gate = new Promise<void>((resolve) => {
				release = () => {
					resolve()
				}
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

	const documentLockKey = (campaignId: string, documentId: string) =>
		`${campaignId}:document:${documentId}`
	const recoveryLockKey = (campaignId: string) => `${campaignId}:recovery`

	const readOptional = (campaignId: string, path: string) =>
		catchAll(
			map(vault.read(campaignId, path), (source): string | null => source),
			(error) => (isMissing(error) ? succeed(null) : failEffect(error))
		)

	const assertBase = (
		actualSource: string | null,
		actualHead: RevisionHead | undefined,
		expectedSourceHash?: string | null,
		expectedRevisionId?: string | null
	) => {
		const actualHash = actualSource === null ? null : sourceHash(actualSource)
		if (expectedSourceHash !== undefined && expectedSourceHash !== actualHash) {
			return failEffect({
				domain: 'vaultRevision',
				operation: 'verifyBase',
				cause: { reason: 'sourceHashMismatch', expectedSourceHash, actualSourceHash: actualHash }
			} satisfies Failure)
		}
		if (
			expectedRevisionId !== undefined &&
			expectedRevisionId !== (actualHead?.revisionId ?? null)
		) {
			return failEffect({
				domain: 'vaultRevision',
				operation: 'verifyBase',
				cause: {
					reason: 'revisionMismatch',
					expectedRevisionId,
					actualRevisionId: actualHead?.revisionId ?? null
				}
			} satisfies Failure)
		}
		return succeed(undefined)
	}

	const recoverManifest = (manifest: RevisionTransactionManifest) =>
		gen(function* () {
			const status = yield* revisions.getTransactionStatus(
				manifest.campaignId,
				manifest.transactionId
			)
			if (status === 'aborted' || status === 'conflicted') {
				return {
					transactionId: manifest.transactionId,
					status
				} satisfies RecoveryResult
			}
			if (status === 'committed') {
				const committed = yield* revisions.getRevision(
					manifest.campaignId,
					manifest.documentId,
					manifest.revisionId
				)
				yield* db.indexRevision(committed)
				return {
					transactionId: manifest.transactionId,
					status: 'committed'
				} satisfies RecoveryResult
			}

			const current = yield* readOptional(manifest.campaignId, manifest.path)
			const currentHash = current === null ? null : sourceHash(current)
			if (currentHash === manifest.beforeHash) {
				yield* revisions.markAborted(manifest.campaignId, manifest.transactionId)
				return { transactionId: manifest.transactionId, status: 'aborted' } satisfies RecoveryResult
			}
			if (currentHash === manifest.afterHash) {
				yield* revisions.markCanonCommitted(manifest.campaignId, manifest.transactionId)
				yield* revisions.promote(manifest.campaignId, manifest.transactionId)
				yield* revisions.markCommitted(manifest.campaignId, manifest.transactionId)
				const committed = yield* revisions.getRevision(
					manifest.campaignId,
					manifest.documentId,
					manifest.revisionId
				)
				yield* db.indexRevision(committed)
				return {
					transactionId: manifest.transactionId,
					status: 'committed'
				} satisfies RecoveryResult
			}

			yield* revisions.markConflicted(manifest.campaignId, manifest.transactionId)
			return {
				transactionId: manifest.transactionId,
				status: 'conflicted'
			} satisfies RecoveryResult
		})

	const commitUnlocked = (input: MutationInput) =>
		gen(function* () {
			const beforeHash =
				input.beforeHashOverride !== undefined
					? input.beforeHashOverride
					: input.beforeSource === null
						? null
						: sourceHash(input.beforeSource)
			const afterHash = input.afterSource === null ? null : sourceHash(input.afterSource)
			const transactionId = randomUUID()
			const revisionId = randomUUID()
			const revision: VaultRevision = {
				schemaVersion: 1,
				revisionId,
				previousRevisionId: input.previousRevisionId,
				transactionId,
				campaignId: input.campaignId,
				documentId: input.documentId,
				path: input.path,
				operation: input.operation,
				source: input.source,
				...(input.relatedSessionId ? { relatedSessionId: input.relatedSessionId } : {}),
				...(input.ingestionId ? { ingestionId: input.ingestionId } : {}),
				createdAt: new Date().toISOString(),
				beforeHash,
				afterHash,
				snapshot: input.afterSource,
				...(input.changeSummary ? { changeSummary: input.changeSummary } : {})
			}
			const manifest: RevisionTransactionManifest = {
				schemaVersion: 1,
				transactionId,
				campaignId: input.campaignId,
				documentId: input.documentId,
				path: input.path,
				revisionId,
				beforeHash,
				afterHash
			}

			const current = yield* readOptional(input.campaignId, input.path)
			const expectedCurrentHash =
				input.expectedCurrentHashOverride !== undefined
					? input.expectedCurrentHashOverride
					: input.operation === 'import' && input.beforeSource === input.afterSource
						? afterHash
						: input.beforeSource === null
							? null
							: sourceHash(input.beforeSource)
			if ((current === null ? null : sourceHash(current)) !== expectedCurrentHash) {
				return yield* failEffect({
					domain: 'vaultRevision',
					operation: 'commitRevision',
					cause: {
						reason: 'sourceHashMismatch',
						expectedSourceHash: expectedCurrentHash,
						actualSourceHash: current === null ? null : sourceHash(current)
					}
				} satisfies Failure)
			}

			yield* revisions.prepare(manifest, revision)

			return yield* pipe(
				gen(function* () {
					const [currentBeforeWrite, headBeforeWrite] = yield* all([
						readOptional(input.campaignId, input.path),
						db.getRevisionHead(input.campaignId, input.documentId)
					])
					const currentHash = currentBeforeWrite === null ? null : sourceHash(currentBeforeWrite)
					if (
						currentHash !== expectedCurrentHash ||
						(headBeforeWrite?.revisionId ?? null) !== input.previousRevisionId
					) {
						return yield* failEffect({
							domain: 'vaultRevision',
							operation: 'commitRevision',
							cause: {
								reason: 'baseChangedBeforeWrite',
								expectedSourceHash: expectedCurrentHash,
								actualSourceHash: currentHash,
								expectedRevisionId: input.previousRevisionId,
								actualRevisionId: headBeforeWrite?.revisionId ?? null
							}
						} satisfies Failure)
					}

					if (input.afterSource !== input.beforeSource) {
						if (input.afterSource === null) {
							yield* vault.delete(input.campaignId, input.path)
						} else if (input.beforeSource === null) {
							yield* vault.create(input.campaignId, input.path, input.afterSource)
						} else {
							yield* vault.write(input.campaignId, input.path, input.afterSource)
						}
					}

					yield* revisions.markCanonCommitted(input.campaignId, transactionId)
					yield* revisions.promote(input.campaignId, transactionId)
					yield* revisions.markCommitted(input.campaignId, transactionId)
					yield* db.indexRevision(revision)
					return revision
				}),
				catchAll((error) =>
					pipe(
						recoverManifest(manifest),
						catchAll(() => succeed(undefined)),
						flatMap(() => failEffect(error))
					)
				)
			)
		})

	const ensureCurrentRevisionUnlocked = (
		campaignId: string,
		documentId: string,
		path: string,
		currentSource: string
	) =>
		gen(function* () {
			const head = yield* db.getRevisionHead(campaignId, documentId)
			const hash = sourceHash(currentSource)
			if (head?.sourceHash === hash && head.path === path) return head

			const imported = yield* commitUnlocked({
				campaignId,
				documentId,
				path,
				operation: 'import',
				source: 'import',
				beforeSource: currentSource,
				afterSource: currentSource,
				beforeHashOverride: head?.sourceHash ?? null,
				previousRevisionId: head?.revisionId ?? null
			})
			return {
				campaignId,
				documentId,
				revisionId: imported.revisionId,
				path,
				sourceHash: imported.afterHash
			}
		})

	const synchronizeDocumentUnlocked = (campaignId: string, documentId: string) =>
		gen(function* () {
			const head = yield* db.getRevisionHead(campaignId, documentId)
			if (!head) return undefined
			const current = yield* readOptional(campaignId, head.path)
			const currentHash = current === null ? null : sourceHash(current)
			if (currentHash === head.sourceHash) return head

			const imported = yield* commitUnlocked({
				campaignId,
				documentId,
				path: head.path,
				operation: 'import',
				source: 'import',
				beforeSource: current,
				afterSource: current,
				beforeHashOverride: head.sourceHash,
				expectedCurrentHashOverride: currentHash,
				previousRevisionId: head.revisionId
			})
			return {
				campaignId,
				documentId,
				revisionId: imported.revisionId,
				path: head.path,
				sourceHash: imported.afterHash
			}
		})

	const withDocumentLock = <Value, Error, Requirements>(
		campaignId: string,
		documentId: string,
		effect: () => Effect<Value, Error, Requirements>
	) =>
		flatMap(ensureCampaignReady(campaignId), () =>
			withLock(documentLockKey(campaignId, documentId), effect)
		)

	const ensureCurrentRevision = (
		campaignId: string,
		documentId: string,
		path: string,
		currentSource: string
	) =>
		withDocumentLock(campaignId, documentId, () =>
			ensureCurrentRevisionUnlocked(campaignId, documentId, path, currentSource)
		)

	const create = (
		campaignId: string,
		documentId: string,
		path: string,
		snapshot: string,
		source: RevisionSource = 'manual'
	) =>
		flatMap(ensureCampaignReady(campaignId), () =>
			withLock(`${campaignId}:path:${path}`, () =>
				commitUnlocked({
					campaignId,
					documentId,
					path,
					operation: 'create',
					source,
					beforeSource: null,
					afterSource: snapshot,
					previousRevisionId: null
				})
			)
		)

	const importSnapshot = (
		campaignId: string,
		documentId: string,
		path: string,
		beforeSource: string,
		afterSource: string = beforeSource
	) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				const existingHead = yield* db.getRevisionHead(campaignId, documentId)
				if (
					afterSource === beforeSource &&
					existingHead?.sourceHash === sourceHash(afterSource) &&
					existingHead.path === path
				) {
					return yield* revisions.getRevision(campaignId, documentId, existingHead.revisionId)
				}
				return yield* commitUnlocked({
					campaignId,
					documentId,
					path,
					operation: 'import',
					source: 'import',
					beforeSource,
					afterSource,
					...(afterSource === beforeSource
						? { beforeHashOverride: existingHead?.sourceHash ?? null }
						: {}),
					previousRevisionId: existingHead?.revisionId ?? null
				})
			})
		)

	const update = (
		campaignId: string,
		documentId: string,
		path: string,
		beforeSource: string,
		afterSource: string,
		options: {
			expectedSourceHash: string
			expectedRevisionId: string
			source?: RevisionSource
			changeSummary?: string
		}
	) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				const current = yield* readOptional(campaignId, path)
				if (current === null) {
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'verifyBase',
						cause: { reason: 'documentMissing' }
					} satisfies Failure)
				}
				const head = yield* ensureCurrentRevisionUnlocked(campaignId, documentId, path, current)
				yield* assertBase(current, head, options.expectedSourceHash, options.expectedRevisionId)
				if (sourceHash(beforeSource) !== options.expectedSourceHash) {
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'verifyBase',
						cause: { reason: 'analyzedSourceMismatch' }
					} satisfies Failure)
				}
				return yield* commitUnlocked({
					campaignId,
					documentId,
					path,
					operation: 'update',
					source: options.source ?? 'manual',
					beforeSource: current,
					afterSource,
					previousRevisionId: head.revisionId,
					changeSummary: options.changeSummary
				})
			})
		)

	const deleteDocument = (
		campaignId: string,
		documentId: string,
		path: string,
		beforeSource: string,
		options: {
			expectedSourceHash: string
			expectedRevisionId: string
			source?: RevisionSource
		}
	) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				const current = yield* readOptional(campaignId, path)
				if (current === null) {
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'verifyBase',
						cause: { reason: 'documentMissing' }
					} satisfies Failure)
				}
				const head = yield* ensureCurrentRevisionUnlocked(campaignId, documentId, path, current)
				yield* assertBase(current, head, options.expectedSourceHash, options.expectedRevisionId)
				if (sourceHash(beforeSource) !== options.expectedSourceHash) {
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'verifyBase',
						cause: { reason: 'analyzedSourceMismatch' }
					} satisfies Failure)
				}
				return yield* commitUnlocked({
					campaignId,
					documentId,
					path,
					operation: 'delete',
					source: options.source ?? 'manual',
					beforeSource: current,
					afterSource: null,
					previousRevisionId: head.revisionId
				})
			})
		)

	const restore = (
		campaignId: string,
		documentId: string,
		revisionId: string,
		options: { expectedSourceHash: string | null; expectedRevisionId: string }
	) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				const head = yield* synchronizeDocumentUnlocked(campaignId, documentId)
				if (!head) {
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'restoreRevision',
						cause: { reason: 'missingHead' }
					} satisfies Failure)
				}
				const selected = yield* revisions.getRevision(campaignId, documentId, revisionId)
				if (selected.snapshot === null) {
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'restoreRevision',
						cause: { reason: 'deletedSnapshot' }
					} satisfies Failure)
				}
				const current = yield* readOptional(campaignId, head.path)
				yield* assertBase(current, head, options.expectedSourceHash, options.expectedRevisionId)
				return yield* commitUnlocked({
					campaignId,
					documentId,
					path: head.path,
					operation: 'restore',
					source: 'restore',
					beforeSource: current,
					afterSource: selected.snapshot,
					previousRevisionId: head.revisionId
				})
			})
		)

	const recoverCampaignUnlocked = (campaignId: string) =>
		gen(function* () {
			const manifests = yield* revisions.listTransactions(campaignId)
			const results: RecoveryResult[] = []
			for (const manifest of manifests) {
				results.push(yield* recoverManifest(manifest))
			}
			const committed = yield* revisions.listCampaignRevisions(campaignId)
			yield* db.replaceCampaignRevisionIndex(campaignId, committed)
			return results
		})

	const ensureCampaignReady = (campaignId: string) =>
		withLock(recoveryLockKey(campaignId), () => {
			if (recoveredCampaigns.has(campaignId)) return succeed(undefined)
			return map(recoverCampaignUnlocked(campaignId), () => {
				recoveredCampaigns.add(campaignId)
			})
		})

	const recoverCampaign = (campaignId: string) =>
		withLock(recoveryLockKey(campaignId), () =>
			map(recoverCampaignUnlocked(campaignId), (results) => {
				recoveredCampaigns.add(campaignId)
				return results
			})
		)

	const listRevisions = (campaignId: string, documentId: string) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				yield* synchronizeDocumentUnlocked(campaignId, documentId)
				const history = yield* revisions.listDocumentRevisions(campaignId, documentId)
				return history.map(({ snapshot, ...revision }): VaultRevisionMetadata => ({
					...revision,
					hasSnapshot: snapshot !== null
				}))
			})
		)

	const getRevision = (campaignId: string, documentId: string, revisionId: string) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				yield* synchronizeDocumentUnlocked(campaignId, documentId)
				return yield* revisions.getRevision(campaignId, documentId, revisionId)
			})
		)

	const diffRevisions = (
		campaignId: string,
		documentId: string,
		toRevisionId: string,
		fromRevisionId?: string
	) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				yield* synchronizeDocumentUnlocked(campaignId, documentId)
				const to = yield* revisions.getRevision(campaignId, documentId, toRevisionId)
				const from = fromRevisionId
					? yield* revisions.getRevision(campaignId, documentId, fromRevisionId)
					: to.previousRevisionId
						? yield* revisions.getRevision(campaignId, documentId, to.previousRevisionId)
						: undefined
				const diff = lineDiff(from?.snapshot ?? '', to.snapshot ?? '')
				return {
					...diff,
					fromRevisionId: from?.revisionId ?? null,
					toRevisionId
				}
			})
		)

	const rebuildIndex = (campaignId: string) =>
		flatMap(ensureCampaignReady(campaignId), () =>
			gen(function* () {
				const committed = yield* revisions.listCampaignRevisions(campaignId)
				yield* db.replaceCampaignRevisionIndex(campaignId, committed)
				return committed
			})
		)

	return {
		create,
		delete: deleteDocument,
		diffRevisions,
		ensureCampaignReady,
		ensureCurrentRevision,
		getRevision,
		importSnapshot,
		listRevisions,
		rebuildIndex,
		recoverCampaign,
		restore,
		update
	}
}
