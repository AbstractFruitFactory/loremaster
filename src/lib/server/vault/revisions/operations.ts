import { createHash, randomUUID } from 'node:crypto'
import {
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
import type { Failure } from '../../failure'
import type { VaultStorage } from '../storage/storage'
import type { RevisionStorage } from './storage'
import type {
	RevisionDiff,
	RevisionHead,
	RevisionOperation,
	RevisionSource,
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
	previousRevisionId: string | null
	writeCanon?: boolean
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

	const readOptional = (campaignId: string, path: string) =>
		catchAll(
			map(vault.read(campaignId, path), (source): string | null => source),
			(error) => (isMissing(error) ? succeed(null) : failEffect(error))
		)

	const assertExpectedRevision = (actualHead: RevisionHead, expectedRevisionId?: string | null) => {
		if (expectedRevisionId !== undefined && expectedRevisionId !== actualHead.revisionId) {
			return failEffect({
				domain: 'vaultRevision',
				operation: 'verifyBase',
				cause: {
					reason: 'revisionMismatch',
					expectedRevisionId,
					actualRevisionId: actualHead.revisionId
				}
			} satisfies Failure)
		}
		return succeed(undefined)
	}

	const commitUnlocked = (input: MutationInput) =>
		gen(function* () {
			const beforeHash =
				input.beforeHashOverride !== undefined
					? input.beforeHashOverride
					: input.beforeSource === null
						? null
						: sourceHash(input.beforeSource)
			const afterHash = input.afterSource === null ? null : sourceHash(input.afterSource)
			const revisionId = randomUUID()
			const revision: VaultRevision = {
				schemaVersion: 1,
				revisionId,
				previousRevisionId: input.previousRevisionId,
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
			if (input.writeCanon !== false && input.afterSource !== input.beforeSource) {
				if (input.afterSource === null) yield* vault.delete(input.campaignId, input.path)
				else if (input.beforeSource === null)
					yield* vault.create(input.campaignId, input.path, input.afterSource)
				else yield* vault.write(input.campaignId, input.path, input.afterSource)
			}

			yield* revisions.write(revision)
			yield* db.indexRevision(revision)
			return revision
		})

	const verifyCurrentRevisionUnlocked = (
		campaignId: string,
		documentId: string,
		path: string,
		currentSource: string | null
	) =>
		gen(function* () {
			const head = yield* db.getRevisionHead(campaignId, documentId)
			if (!head) {
				return yield* failEffect({
					domain: 'vaultRevision',
					operation: 'verifyCanon',
					cause: { reason: 'missingRevisionHead', campaignId, documentId }
				} satisfies Failure)
			}
			if (head.path !== path) {
				return yield* failEffect({
					domain: 'vaultRevision',
					operation: 'verifyCanon',
					cause: { reason: 'canonicalPathMismatch', expectedPath: head.path, actualPath: path }
				} satisfies Failure)
			}
			const currentHash = currentSource === null ? null : sourceHash(currentSource)
			if (head.sourceHash !== currentHash) {
				return yield* failEffect({
					domain: 'vaultRevision',
					operation: 'verifyCanon',
					cause: {
						reason: 'canonicalHashMismatch',
						expectedSourceHash: head.sourceHash,
						actualSourceHash: currentHash
					}
				} satisfies Failure)
			}
			return head
		})

	const withDocumentLock = <Value, Error, Requirements>(
		campaignId: string,
		documentId: string,
		effect: () => Effect<Value, Error, Requirements>
	) => withLock(documentLockKey(campaignId, documentId), effect)

	const verifyCurrentRevision = (
		campaignId: string,
		documentId: string,
		path: string,
		currentSource: string
	) =>
		withDocumentLock(campaignId, documentId, () =>
			verifyCurrentRevisionUnlocked(campaignId, documentId, path, currentSource)
		)

	const create = (
		campaignId: string,
		documentId: string,
		path: string,
		snapshot: string,
		options: {
			source?: RevisionSource
			relatedSessionId?: string
			ingestionId?: string
			changeSummary?: string
		} = {}
	) =>
		withLock(`${campaignId}:path:${path}`, () =>
			commitUnlocked({
				campaignId,
				documentId,
				path,
				operation: 'create',
				source: options.source ?? 'manual',
				beforeSource: null,
				afterSource: snapshot,
				previousRevisionId: null,
				relatedSessionId: options.relatedSessionId,
				ingestionId: options.ingestionId,
				changeSummary: options.changeSummary
			})
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
					writeCanon: afterSource !== beforeSource,
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
			expectedRevisionId: string
			source?: RevisionSource
			relatedSessionId?: string
			ingestionId?: string
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
				const head = yield* verifyCurrentRevisionUnlocked(campaignId, documentId, path, current)
				yield* assertExpectedRevision(head, options.expectedRevisionId)
				if (sourceHash(beforeSource) !== head.sourceHash) {
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
					relatedSessionId: options.relatedSessionId,
					ingestionId: options.ingestionId,
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
				const head = yield* verifyCurrentRevisionUnlocked(campaignId, documentId, path, current)
				yield* assertExpectedRevision(head, options.expectedRevisionId)
				if (sourceHash(beforeSource) !== head.sourceHash) {
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
		options: { expectedRevisionId: string }
	) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
				const existingHead = yield* db.getRevisionHead(campaignId, documentId)
				if (!existingHead)
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'restoreRevision',
						cause: { reason: 'missingHead' }
					} satisfies Failure)
				const current = yield* readOptional(campaignId, existingHead.path)
				const head = yield* verifyCurrentRevisionUnlocked(
					campaignId,
					documentId,
					existingHead.path,
					current
				)
				const selected = yield* revisions.getRevision(campaignId, documentId, revisionId)
				if (selected.snapshot === null) {
					return yield* failEffect({
						domain: 'vaultRevision',
						operation: 'restoreRevision',
						cause: { reason: 'deletedSnapshot' }
					} satisfies Failure)
				}
				yield* assertExpectedRevision(head, options.expectedRevisionId)
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

	const listRevisions = (campaignId: string, documentId: string) =>
		withDocumentLock(campaignId, documentId, () =>
			map(revisions.listDocumentRevisions(campaignId, documentId), (history) =>
				history.map(({ snapshot, ...revision }): VaultRevisionMetadata => ({
					...revision,
					hasSnapshot: snapshot !== null
				}))
			)
		)

	const getRevision = (campaignId: string, documentId: string, revisionId: string) =>
		withDocumentLock(campaignId, documentId, () =>
			revisions.getRevision(campaignId, documentId, revisionId)
		)

	const diffRevisions = (
		campaignId: string,
		documentId: string,
		toRevisionId: string,
		fromRevisionId?: string
	) =>
		withDocumentLock(campaignId, documentId, () =>
			gen(function* () {
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
		gen(function* () {
			const committed = yield* revisions.listCampaignRevisions(campaignId)
			yield* db.replaceCampaignRevisionIndex(campaignId, committed)
			return committed
		})

	return {
		create,
		delete: deleteDocument,
		diffRevisions,
		verifyCurrentRevision,
		getRevision,
		importSnapshot,
		listRevisions,
		rebuildIndex,
		restore,
		update
	}
}
