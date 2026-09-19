import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tryPromise } from 'effect/Effect'
import { failure } from '../failure.js'
import {
	acquireOwnedFileLock,
	fileExists,
	ingestionRoot,
	ingestionsRoot,
	isFileError,
	json,
	readOptionalJson,
	releaseOwnedFileLock,
	withOwnedFileLockHeartbeat,
	writeAtomic,
	writeIfAbsent,
	writeImmutable
} from './filesystem-persistence.js'
import {
	campaignImportContentHash,
	campaignImportSourceId,
	campaignImportSourceRevisionId
} from './ids.js'
import {
	CampaignImportNotFoundError,
	CampaignImportOperationLeaseBusyError,
	CampaignImportPermanenceError,
	CampaignImportReviewCommitConflictError,
	CampaignImportReviewLockBusyError,
	CampaignImportReviewLockedError,
	CampaignImportReviewRevisionConflictError,
	CampaignImportSourceIntegrityError,
	CommitStartedIngestionDiscardError,
	IncompleteCampaignImportCleanupError,
	isImmutableIngestionConflict
} from './storage-errors.js'
import type { CampaignImportStorage } from './storage.js'
import type {
	CampaignImportChronologyCommitData,
	CampaignImportChronologyCompletionData,
	CampaignImportChronologyDispatchData,
	CampaignImportChronologyDraft,
	CampaignImportCommitData,
	CampaignImportCompletionData,
	CampaignImportDraft,
	CampaignImportLifecycleStorageState,
	CampaignImportRequestData,
	CampaignImportReviewState,
	CampaignImportSourceData,
	CampaignImportSummary
} from './types.js'

const CAMPAIGN_IMPORT_REVIEW_LOCK_STALE_MS = 30_000
const CAMPAIGN_IMPORT_REVIEW_LOCK_HEARTBEAT_MS = 10_000
const CAMPAIGN_IMPORT_OPERATION_LEASE_MAX_WEB_OPERATION_STALE_MS = 30 * 60_000
const CAMPAIGN_IMPORT_REVIEW_LOCK_WAIT_MS = 500
const CAMPAIGN_IMPORT_REVIEW_LOCK_RETRY_MS = 10

const campaignImportSourceSegment = (value: string) => {
	if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/u.test(value)) {
		throw new CampaignImportSourceIntegrityError()
	}
	return value
}

const ingestionSegment = (value: string) => {
	if (!/^[\w-]+$/u.test(value)) throw new CampaignImportSourceIntegrityError()
	return value
}

const campaignImportRequestFingerprint = (request: CampaignImportRequestData) =>
	JSON.stringify({
		schemaVersion: request.schemaVersion,
		kind: request.kind,
		ingestionId: request.ingestionId,
		campaignId: request.campaignId,
		sources: request.sources.map((source) => ({
			displayName: source.displayName,
			sourceId: source.sourceId,
			sourceRevisionId: source.sourceRevisionId,
			title: source.title,
			mediaType: source.mediaType,
			contentHash: source.contentHash,
			byteLength: source.byteLength
		}))
	})

const sortedUnique = (values: string[]) => [...new Set(values)].sort()

const campaignImportResolutionKey = (
	resolution: CampaignImportReviewState['resolutions'][number]
) =>
	resolution.kind === 'existing'
		? `${resolution.proposalId}\0${resolution.kind}\0${resolution.documentId}`
		: `${resolution.proposalId}\0${resolution.kind}`

type CampaignImportFilesystemStorage = Omit<
	CampaignImportStorage,
	'readCommitJournal' | 'writeCommitJournal'
>

export const filesystemCampaignImportStorage = (
	rootPath: string
): CampaignImportFilesystemStorage => {
	const rootFor = (campaignId: string, ingestionId: string) =>
		ingestionRoot(rootPath, campaignId, ingestionId)
	const sourceRootFor = (campaignId: string, sourceId: string) =>
		resolve(
			rootPath,
			campaignId,
			'.loremaster',
			'import-sources',
			campaignImportSourceSegment(sourceId)
		)
	const sourcePathFor = (campaignId: string, sourceId: string, sourceRevisionId: string) =>
		resolve(
			sourceRootFor(campaignId, sourceId),
			`${campaignImportSourceSegment(sourceRevisionId)}.txt`
		)
	const cleanupVerificationRootFor = (campaignId: string) =>
		resolve(rootPath, campaignId, '.loremaster', 'import-cleanups')
	const cleanupVerificationPathFor = (campaignId: string, ingestionId: string) =>
		resolve(cleanupVerificationRootFor(campaignId), `${ingestionSegment(ingestionId)}.json`)
	const cleanupStartedPathFor = (campaignId: string, ingestionId: string) =>
		resolve(cleanupVerificationRootFor(campaignId), `${ingestionSegment(ingestionId)}.started.json`)
	const reviewLockPathFor = (campaignId: string, ingestionId: string) =>
		resolve(rootFor(campaignId, ingestionId), '.review-state.lock')
	const operationLeaseRootFor = (campaignId: string) =>
		resolve(rootPath, campaignId, '.loremaster', 'import-operation-locks')
	const operationLeasePathFor = (campaignId: string, ingestionId: string) =>
		resolve(operationLeaseRootFor(campaignId), `${ingestionSegment(ingestionId)}.lock`)

	const withCampaignImportReviewLock = async <Value>(
		campaignId: string,
		ingestionId: string,
		operation: () => Promise<Value>
	): Promise<Value> => {
		const path = reviewLockPathFor(campaignId, ingestionId)
		const lease = await acquireOwnedFileLock(path, {
			waitMs: CAMPAIGN_IMPORT_REVIEW_LOCK_WAIT_MS,
			staleMs: CAMPAIGN_IMPORT_REVIEW_LOCK_STALE_MS,
			busyError: () => new CampaignImportReviewLockBusyError(),
			retryMs: CAMPAIGN_IMPORT_REVIEW_LOCK_RETRY_MS
		})
		return withOwnedFileLockHeartbeat(
			path,
			lease,
			operation,
			CAMPAIGN_IMPORT_REVIEW_LOCK_HEARTBEAT_MS
		)
	}

	const readJson = <Value, Operation extends string>(
		campaignId: string,
		ingestionId: string,
		filename: string,
		operation: Operation
	) =>
		tryPromise({
			try: async () =>
				JSON.parse(
					await readFile(resolve(rootFor(campaignId, ingestionId), filename), 'utf8')
				) as Value,
			catch: (cause) => failure('ingestionStorage', operation, cause)
		})

	const writeCampaignImportData = (
		data: CampaignImportRequestData,
		sources: CampaignImportSourceData[]
	) =>
		tryPromise({
			try: async () => {
				const sourceByRevisionId = new Map(
					sources.map((source) => [source.sourceRevisionId, source])
				)
				if (
					sources.length !== data.sources.length ||
					sourceByRevisionId.size !== data.sources.length
				) {
					throw new CampaignImportSourceIntegrityError()
				}
				for (const [sourceSlot, descriptor] of data.sources.entries()) {
					const source = sourceByRevisionId.get(descriptor.sourceRevisionId)
					if (
						!source ||
						source.displayName !== descriptor.displayName ||
						source.sourceId !== descriptor.sourceId ||
						source.sourceRevisionId !== descriptor.sourceRevisionId ||
						source.title !== descriptor.title ||
						source.mediaType !== descriptor.mediaType ||
						source.contentHash !== descriptor.contentHash ||
						source.byteLength !== descriptor.byteLength ||
						campaignImportContentHash(source.content) !== descriptor.contentHash ||
						campaignImportSourceId(data.ingestionId, sourceSlot) !== descriptor.sourceId ||
						campaignImportSourceRevisionId(descriptor.sourceId, descriptor.contentHash) !==
							descriptor.sourceRevisionId ||
						Buffer.byteLength(source.content) !== descriptor.byteLength
					) {
						throw new CampaignImportSourceIntegrityError()
					}
				}
				const root = rootFor(data.campaignId, data.ingestionId)
				await Promise.all([
					mkdir(root, { recursive: true }),
					...data.sources.map(({ sourceId }) =>
						mkdir(sourceRootFor(data.campaignId, sourceId), { recursive: true })
					)
				])
				const requestPath = resolve(root, 'request.json')
				let canonicalRequest = data
				try {
					await writeImmutable(requestPath, json(data))
				} catch (cause) {
					if (!isImmutableIngestionConflict(cause)) throw cause
					const existing = JSON.parse(
						await readFile(requestPath, 'utf8')
					) as CampaignImportRequestData
					if (
						typeof existing.createdAt !== 'string' ||
						campaignImportRequestFingerprint(existing) !== campaignImportRequestFingerprint(data)
					) {
						throw cause
					}
					canonicalRequest = existing
				}
				await Promise.all(
					data.sources.map(({ sourceId, sourceRevisionId }) =>
						writeImmutable(
							sourcePathFor(data.campaignId, sourceId, sourceRevisionId),
							sourceByRevisionId.get(sourceRevisionId)!.content
						)
					)
				)
				return canonicalRequest
			},
			catch: (cause) => failure('ingestionStorage', 'writeCampaignImportData', cause)
		})

	const writeCampaignImportDraft = (draft: CampaignImportDraft) =>
		tryPromise({
			try: async () => {
				const root = rootFor(draft.campaignId, draft.ingestionId)
				await mkdir(root, { recursive: true })
				await writeImmutable(resolve(root, 'analysis.json'), json(draft))
			},
			catch: (cause) => failure('ingestionStorage', 'writeCampaignImportDraft', cause)
		})

	const initializeCampaignImportReviewState = (state: CampaignImportReviewState) =>
		tryPromise({
			try: () =>
				withCampaignImportReviewLock(state.campaignId, state.ingestionId, async () => {
					const root = rootFor(state.campaignId, state.ingestionId)
					await mkdir(root, { recursive: true })
					await writeIfAbsent(resolve(root, 'review-state.json'), json(state))
				}),
			catch: (cause) => failure('ingestionStorage', 'initializeCampaignImportReviewState', cause)
		})

	const writeCampaignImportReviewState = (state: CampaignImportReviewState) =>
		tryPromise({
			try: () =>
				withCampaignImportReviewLock(state.campaignId, state.ingestionId, async () => {
					const root = rootFor(state.campaignId, state.ingestionId)
					await mkdir(root, { recursive: true })
					if (await fileExists(resolve(root, 'import-commit-request.json'))) {
						throw new CampaignImportReviewLockedError()
					}
					await writeAtomic(resolve(root, 'review-state.json'), json(state))
				}),
			catch: (cause) => failure('ingestionStorage', 'writeCampaignImportReviewState', cause)
		})

	const readCampaignImportLifecycleStateValue = async (
		campaignId: string,
		ingestionId: string
	): Promise<CampaignImportLifecycleStorageState> => {
		const root = rootFor(campaignId, ingestionId)
		const request = await readOptionalJson<CampaignImportRequestData>(resolve(root, 'request.json'))
		if (
			request?.kind !== 'campaign-import' ||
			request.campaignId !== campaignId ||
			request.ingestionId !== ingestionId
		) {
			throw new CampaignImportNotFoundError()
		}
		const [
			draft,
			commitRequested,
			completion,
			chronologyDispatch,
			chronologyDraft,
			chronologyCommitData,
			chronologyCompletion
		] = await Promise.all([
			readOptionalJson<CampaignImportDraft>(resolve(root, 'analysis.json')),
			fileExists(resolve(root, 'import-commit-request.json')),
			readOptionalJson<CampaignImportCompletionData>(resolve(root, 'import-completion.json')),
			readOptionalJson<CampaignImportChronologyDispatchData>(
				resolve(root, 'chronology-dispatch.json')
			),
			readOptionalJson<CampaignImportChronologyDraft>(resolve(root, 'chronology-analysis.json')),
			readOptionalJson<CampaignImportChronologyCommitData>(
				resolve(root, 'chronology-commit-request.json')
			),
			readOptionalJson<CampaignImportChronologyCompletionData>(
				resolve(root, 'chronology-completion.json')
			)
		])
		return {
			request,
			...(draft ? { draft } : {}),
			commitRequested,
			...(completion ? { completion } : {}),
			...(chronologyDispatch ? { chronologyDispatch } : {}),
			...(chronologyDraft ? { chronologyDraft } : {}),
			...(chronologyCommitData ? { chronologyCommitData } : {}),
			...(chronologyCompletion ? { chronologyCompletion } : {})
		}
	}

	return {
		writeCampaignImportData,
		readCampaignImportData: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'request.json', 'readCampaignImportData'),
		readCampaignImportSource: (campaignId, sourceId, sourceRevisionId) =>
			tryPromise({
				try: () => readFile(sourcePathFor(campaignId, sourceId, sourceRevisionId), 'utf8'),
				catch: (cause) => failure('ingestionStorage', 'readCampaignImportSource', cause)
			}),
		writeCampaignImportDraft,
		readCampaignImportDraft: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'analysis.json', 'readCampaignImportDraft'),
		initializeCampaignImportReviewState,
		writeCampaignImportReviewState,
		readCampaignImportReviewState: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'review-state.json', 'readCampaignImportReviewState'),
		updateCampaignImportReviewState: (state, expectedRevision) =>
			tryPromise({
				try: () =>
					withCampaignImportReviewLock(state.campaignId, state.ingestionId, async () => {
						const root = rootFor(state.campaignId, state.ingestionId)
						if (await fileExists(resolve(root, 'import-commit-request.json'))) {
							throw new CampaignImportReviewLockedError()
						}
						const current = JSON.parse(
							await readFile(resolve(root, 'review-state.json'), 'utf8')
						) as CampaignImportReviewState
						if (current.revision !== expectedRevision || state.revision !== expectedRevision + 1) {
							throw new CampaignImportReviewRevisionConflictError(
								expectedRevision,
								current.revision
							)
						}
						await writeAtomic(resolve(root, 'review-state.json'), json(state))
						return state
					}),
				catch: (cause) => failure('ingestionStorage', 'updateCampaignImportReviewState', cause)
			}),
		writeCampaignImportCommitData: (data) =>
			tryPromise({
				try: () =>
					withCampaignImportReviewLock(data.campaignId, data.ingestionId, async () => {
						const root = rootFor(data.campaignId, data.ingestionId)
						await mkdir(root, { recursive: true })
						const reviewState = JSON.parse(
							await readFile(resolve(root, 'review-state.json'), 'utf8')
						) as CampaignImportReviewState
						if (reviewState.revision !== data.expectedReviewRevision) {
							throw new CampaignImportReviewCommitConflictError('staleRevision')
						}
						const selectedProposalIds = sortedUnique(data.selectedProposalIds)
						if (
							JSON.stringify(selectedProposalIds) !==
							JSON.stringify(sortedUnique(reviewState.selectedProposalIds))
						) {
							throw new CampaignImportReviewCommitConflictError('selectionMismatch')
						}
						const selectedProposalIdSet = new Set(selectedProposalIds)
						const commitResolutions = data.resolutions ?? []
						if (
							commitResolutions.some(
								(resolution) => !selectedProposalIdSet.has(resolution.proposalId)
							)
						) {
							throw new CampaignImportReviewCommitConflictError('selectionMismatch')
						}
						const expectedResolutionKeys = reviewState.resolutions
							.filter((resolution) => selectedProposalIdSet.has(resolution.proposalId))
							.map(campaignImportResolutionKey)
							.sort()
						const commitResolutionKeys = commitResolutions.map(campaignImportResolutionKey).sort()
						if (JSON.stringify(commitResolutionKeys) !== JSON.stringify(expectedResolutionKeys)) {
							throw new CampaignImportReviewCommitConflictError('selectionMismatch')
						}
						await writeImmutable(resolve(root, 'import-commit-request.json'), json(data))
					}),
				catch: (cause) => failure('ingestionStorage', 'writeCampaignImportCommitData', cause)
			}),
		readCampaignImportCommitData: (campaignId, ingestionId) =>
			readJson(
				campaignId,
				ingestionId,
				'import-commit-request.json',
				'readCampaignImportCommitData'
			),
		writeCampaignImportCommitPlan: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeImmutable(resolve(root, 'import-commit-plan.json'), json(data))
				},
				catch: (cause) => failure('ingestionStorage', 'writeCampaignImportCommitPlan', cause)
			}),
		readCampaignImportCommitPlan: (campaignId, ingestionId) =>
			tryPromise({
				try: () =>
					readOptionalJson(resolve(rootFor(campaignId, ingestionId), 'import-commit-plan.json')),
				catch: (cause) => failure('ingestionStorage', 'readCampaignImportCommitPlan', cause)
			}),
		writeCampaignImportCompletion: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeImmutable(resolve(root, 'import-completion.json'), json(data))
				},
				catch: (cause) => failure('ingestionStorage', 'writeCampaignImportCompletion', cause)
			}),
		readCampaignImportCompletion: (campaignId, ingestionId) =>
			tryPromise({
				try: () =>
					readOptionalJson(resolve(rootFor(campaignId, ingestionId), 'import-completion.json')),
				catch: (cause) => failure('ingestionStorage', 'readCampaignImportCompletion', cause)
			}),
		writeCampaignImportChronologyDispatch: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeAtomic(resolve(root, 'chronology-dispatch.json'), json(data))
				},
				catch: (cause) =>
					failure('ingestionStorage', 'writeCampaignImportChronologyDispatch', cause)
			}),
		readCampaignImportChronologyDispatch: (campaignId, ingestionId) =>
			tryPromise({
				try: () =>
					readOptionalJson(resolve(rootFor(campaignId, ingestionId), 'chronology-dispatch.json')),
				catch: (cause) => failure('ingestionStorage', 'readCampaignImportChronologyDispatch', cause)
			}),
		writeCampaignImportChronologyDraft: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeImmutable(resolve(root, 'chronology-analysis.json'), json(data))
				},
				catch: (cause) => failure('ingestionStorage', 'writeCampaignImportChronologyDraft', cause)
			}),
		readCampaignImportChronologyDraft: (campaignId, ingestionId) =>
			readJson(
				campaignId,
				ingestionId,
				'chronology-analysis.json',
				'readCampaignImportChronologyDraft'
			),
		writeCampaignImportChronologyCommitData: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeImmutable(resolve(root, 'chronology-commit-request.json'), json(data))
				},
				catch: (cause) =>
					failure('ingestionStorage', 'writeCampaignImportChronologyCommitData', cause)
			}),
		readCampaignImportChronologyCommitData: (campaignId, ingestionId) =>
			readJson(
				campaignId,
				ingestionId,
				'chronology-commit-request.json',
				'readCampaignImportChronologyCommitData'
			),
		writeCampaignImportChronologyCommitPlan: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeImmutable(resolve(root, 'chronology-commit-plan.json'), json(data))
				},
				catch: (cause) =>
					failure('ingestionStorage', 'writeCampaignImportChronologyCommitPlan', cause)
			}),
		readCampaignImportChronologyCommitPlan: (campaignId, ingestionId) =>
			tryPromise({
				try: () =>
					readOptionalJson(
						resolve(rootFor(campaignId, ingestionId), 'chronology-commit-plan.json')
					),
				catch: (cause) =>
					failure('ingestionStorage', 'readCampaignImportChronologyCommitPlan', cause)
			}),
		writeCampaignImportChronologyCompletion: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeImmutable(resolve(root, 'chronology-completion.json'), json(data))
				},
				catch: (cause) =>
					failure('ingestionStorage', 'writeCampaignImportChronologyCompletion', cause)
			}),
		readCampaignImportChronologyCompletion: (campaignId, ingestionId) =>
			tryPromise({
				try: () =>
					readOptionalJson(resolve(rootFor(campaignId, ingestionId), 'chronology-completion.json')),
				catch: (cause) =>
					failure('ingestionStorage', 'readCampaignImportChronologyCompletion', cause)
			}),
		readCampaignImportLifecycleState: (campaignId, ingestionId) =>
			tryPromise({
				try: () => readCampaignImportLifecycleStateValue(campaignId, ingestionId),
				catch: (cause) => failure('ingestionStorage', 'readCampaignImportLifecycleState', cause)
			}),
		verifyCampaignImportSourceBodies: (campaignId, sources) =>
			tryPromise({
				try: async () => {
					const missingOrInvalid: string[] = []
					for (const source of sources) {
						try {
							const content = await readFile(
								sourcePathFor(campaignId, source.sourceId, source.sourceRevisionId),
								'utf8'
							)
							if (
								campaignImportContentHash(content) !== source.contentHash ||
								Buffer.byteLength(content) !== source.byteLength
							) {
								missingOrInvalid.push(source.sourceRevisionId)
							}
						} catch (cause) {
							if (!isFileError(cause, 'ENOENT')) throw cause
							missingOrInvalid.push(source.sourceRevisionId)
						}
					}
					if (missingOrInvalid.length) {
						throw new CampaignImportPermanenceError({
							missingOrInvalidSourceRevisionIds: missingOrInvalid
						})
					}
				},
				catch: (cause) => failure('ingestionStorage', 'verifyCampaignImportSourceBodies', cause)
			}),
		isCampaignImportCleanupVerified: (campaignId, ingestionId) =>
			tryPromise({
				try: () => fileExists(cleanupVerificationPathFor(campaignId, ingestionId)),
				catch: (cause) => failure('ingestionStorage', 'isCampaignImportCleanupVerified', cause)
			}),
		isCampaignImportCleanupStarted: (campaignId, ingestionId) =>
			tryPromise({
				try: async () =>
					(await fileExists(cleanupStartedPathFor(campaignId, ingestionId))) ||
					(await fileExists(cleanupVerificationPathFor(campaignId, ingestionId))),
				catch: (cause) => failure('ingestionStorage', 'isCampaignImportCleanupStarted', cause)
			}),
		markCampaignImportCleanupStarted: (campaignId, ingestionId) =>
			tryPromise({
				try: async () => {
					await mkdir(cleanupVerificationRootFor(campaignId), { recursive: true })
					await writeImmutable(
						cleanupStartedPathFor(campaignId, ingestionId),
						json({
							schemaVersion: 1,
							kind: 'campaign-import-cleanup-started',
							campaignId,
							ingestionId,
							started: true
						})
					)
				},
				catch: (cause) => failure('ingestionStorage', 'markCampaignImportCleanupStarted', cause)
			}),
		markCampaignImportCleanupVerified: (campaignId, ingestionId) =>
			tryPromise({
				try: async () => {
					await mkdir(cleanupVerificationRootFor(campaignId), { recursive: true })
					await writeImmutable(
						cleanupVerificationPathFor(campaignId, ingestionId),
						json({
							schemaVersion: 1,
							kind: 'campaign-import-cleanup-verification',
							campaignId,
							ingestionId,
							verified: true
						})
					)
				},
				catch: (cause) => failure('ingestionStorage', 'markCampaignImportCleanupVerified', cause)
			}),
		acquireCampaignImportOperationLease: (campaignId, ingestionId) =>
			tryPromise({
				try: () =>
					acquireOwnedFileLock(operationLeasePathFor(campaignId, ingestionId), {
						waitMs: 0,
						staleMs: CAMPAIGN_IMPORT_OPERATION_LEASE_MAX_WEB_OPERATION_STALE_MS,
						busyError: () => new CampaignImportOperationLeaseBusyError(),
						retryMs: CAMPAIGN_IMPORT_REVIEW_LOCK_RETRY_MS
					}),
				catch: (cause) => failure('ingestionStorage', 'acquireCampaignImportOperationLease', cause)
			}),
		releaseCampaignImportOperationLease: (campaignId, ingestionId, lease) =>
			tryPromise({
				try: () =>
					releaseOwnedFileLock(operationLeasePathFor(campaignId, ingestionId), lease.ownerToken),
				catch: (cause) => failure('ingestionStorage', 'releaseCampaignImportOperationLease', cause)
			}),
		listCampaignImports: (campaignId) =>
			tryPromise({
				try: async () => {
					let entries: Dirent[]
					try {
						entries = await readdir(ingestionsRoot(rootPath, campaignId), {
							withFileTypes: true
						})
					} catch (cause) {
						if (isFileError(cause, 'ENOENT')) return []
						throw cause
					}
					const summaries = await Promise.all(
						entries
							.filter((entry) => entry.isDirectory())
							.map(async (entry): Promise<CampaignImportSummary | undefined> => {
								const root = rootFor(campaignId, entry.name)
								const request = await readOptionalJson<CampaignImportRequestData>(
									resolve(root, 'request.json')
								)
								if (
									request?.kind !== 'campaign-import' ||
									request.campaignId !== campaignId ||
									request.ingestionId !== entry.name
								) {
									return undefined
								}
								const state = await readCampaignImportLifecycleStateValue(campaignId, entry.name)
								const phase = state.chronologyCompletion
									? 'ready-to-finish'
									: state.chronologyCommitData
										? 'chronology-committing'
										: state.chronologyDraft
											? 'chronology-review'
											: state.chronologyDispatch?.status === 'failed'
												? 'failed'
												: state.completion
													? 'chronology-analyzing'
													: state.commitRequested
														? 'committing'
														: state.draft
															? 'review'
															: 'analyzing'
								return {
									ingestionId: request.ingestionId,
									campaignId,
									createdAt: state.draft?.createdAt ?? request.createdAt,
									phase,
									canDiscard: !state.commitRequested
								}
							})
					)
					return summaries
						.filter((summary): summary is CampaignImportSummary => Boolean(summary))
						.sort(
							(left, right) =>
								right.createdAt.localeCompare(left.createdAt) ||
								left.ingestionId.localeCompare(right.ingestionId)
						)
				},
				catch: (cause) => failure('ingestionStorage', 'listCampaignImports', cause)
			}),
		discardCampaignImport: (campaignId, ingestionId) =>
			tryPromise({
				try: async () => {
					const root = rootFor(campaignId, ingestionId)
					const request = await readOptionalJson<CampaignImportRequestData>(
						resolve(root, 'request.json')
					)
					if (request?.kind !== 'campaign-import') return
					if (await fileExists(resolve(root, 'import-commit-request.json'))) {
						throw new CommitStartedIngestionDiscardError()
					}
					await rm(root, { recursive: true, force: true })
				},
				catch: (cause) => failure('ingestionStorage', 'discardCampaignImport', cause)
			}),
		cleanupCampaignImport: (campaignId, ingestionId) =>
			tryPromise({
				try: async () => {
					const root = rootFor(campaignId, ingestionId)
					if (!(await fileExists(root))) return
					const [request, completion, chronologyCommitData, chronologyCompletion] =
						await Promise.all([
							readOptionalJson<CampaignImportRequestData>(resolve(root, 'request.json')),
							readOptionalJson<CampaignImportCompletionData>(
								resolve(root, 'import-completion.json')
							),
							readOptionalJson<CampaignImportChronologyCommitData>(
								resolve(root, 'chronology-commit-request.json')
							),
							readOptionalJson<CampaignImportChronologyCompletionData>(
								resolve(root, 'chronology-completion.json')
							)
						])
					if (
						request?.kind !== 'campaign-import' ||
						request.campaignId !== campaignId ||
						request.ingestionId !== ingestionId ||
						completion?.kind !== 'campaign-import-completion' ||
						completion.campaignId !== campaignId ||
						completion.ingestionId !== ingestionId ||
						(chronologyCommitData !== undefined &&
							(chronologyCompletion?.kind !== 'campaign-import-chronology-completion' ||
								chronologyCompletion.campaignId !== campaignId ||
								chronologyCompletion.ingestionId !== ingestionId))
					) {
						throw new IncompleteCampaignImportCleanupError()
					}
					await rm(root, { recursive: true, force: true })
				},
				catch: (cause) => failure('ingestionStorage', 'cleanupCampaignImport', cause)
			})
	}
}
