import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import {
	access,
	link,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	rmdir,
	stat,
	unlink,
	writeFile
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../failure.js'
import {
	campaignImportContentHash,
	campaignImportSourceId,
	campaignImportSourceRevisionId
} from './ids.js'
import type {
	CampaignImportCommitData,
	CampaignImportCommitPlanData,
	CampaignImportChronologyCommitData,
	CampaignImportChronologyCommitPlanData,
	CampaignImportChronologyCompletionData,
	CampaignImportChronologyDispatchData,
	CampaignImportChronologyDraft,
	CampaignImportCompletionData,
	CampaignImportDraft,
	CampaignImportLifecycleStorageState,
	CampaignImportRequestData,
	CampaignImportReviewState,
	CampaignImportSource,
	CampaignImportSourceData,
	CampaignImportSummary,
	SessionCommitJournal,
	SessionCommitData,
	SessionIngestionDraft,
	SessionIngestionSummary,
	SessionTranscriptData
} from './types.js'

export type IngestionStorage = {
	write: (
		draft: SessionIngestionDraft,
		transcript: string
	) => Effect<void, Failure<'ingestionStorage', 'write'>>
	writeTranscriptData?: (
		data: SessionTranscriptData
	) => Effect<void, Failure<'ingestionStorage', 'writeTranscriptData'>>
	readTranscriptData?: (
		campaignId: string,
		ingestionId: string
	) => Effect<SessionTranscriptData, Failure<'ingestionStorage', 'readTranscriptData'>>
	writeDraft?: (
		draft: SessionIngestionDraft
	) => Effect<void, Failure<'ingestionStorage', 'writeDraft'>>
	read: (
		campaignId: string,
		ingestionId: string
	) => Effect<SessionIngestionDraft, Failure<'ingestionStorage', 'read'>>
	readTranscript: (
		campaignId: string,
		ingestionId: string
	) => Effect<string, Failure<'ingestionStorage', 'readTranscript'>>
	writeCommitData?: (
		data: SessionCommitData
	) => Effect<void, Failure<'ingestionStorage', 'writeCommitData'>>
	readCommitData?: (
		campaignId: string,
		ingestionId: string
	) => Effect<SessionCommitData, Failure<'ingestionStorage', 'readCommitData'>>
	readCommitJournal?: (
		campaignId: string,
		ingestionId: string
	) => Effect<SessionCommitJournal | undefined, Failure<'ingestionStorage', 'readCommitJournal'>>
	writeCommitJournal?: (
		journal: SessionCommitJournal
	) => Effect<void, Failure<'ingestionStorage', 'writeCommitJournal'>>
	list?: (
		campaignId: string
	) => Effect<SessionIngestionSummary[], Failure<'ingestionStorage', 'list'>>
	discard?: (
		campaignId: string,
		ingestionId: string
	) => Effect<void, Failure<'ingestionStorage', 'discard'>>
}

export type CampaignImportAnalysisStorage = {
	writeCampaignImportData: (
		data: CampaignImportRequestData,
		sources: CampaignImportSourceData[]
	) => Effect<CampaignImportRequestData, Failure<'ingestionStorage', 'writeCampaignImportData'>>
	readCampaignImportData: (
		campaignId: string,
		ingestionId: string
	) => Effect<CampaignImportRequestData, Failure<'ingestionStorage', 'readCampaignImportData'>>
	readCampaignImportSource: (
		campaignId: string,
		sourceId: string,
		sourceRevisionId: string
	) => Effect<string, Failure<'ingestionStorage', 'readCampaignImportSource'>>
	writeCampaignImportDraft: (
		draft: CampaignImportDraft
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportDraft'>>
	readCampaignImportDraft: (
		campaignId: string,
		ingestionId: string
	) => Effect<CampaignImportDraft, Failure<'ingestionStorage', 'readCampaignImportDraft'>>
}

export type CampaignImportReviewStorage = {
	initializeCampaignImportReviewState: (
		state: CampaignImportReviewState
	) => Effect<void, Failure<'ingestionStorage', 'initializeCampaignImportReviewState'>>
	writeCampaignImportReviewState: (
		state: CampaignImportReviewState
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportReviewState'>>
	readCampaignImportReviewState: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportReviewState,
		Failure<'ingestionStorage', 'readCampaignImportReviewState'>
	>
	updateCampaignImportReviewState: (
		state: CampaignImportReviewState,
		expectedRevision: number
	) => Effect<
		CampaignImportReviewState,
		Failure<'ingestionStorage', 'updateCampaignImportReviewState'>
	>
}

export type CampaignImportBaseCommitStorage = {
	writeCampaignImportCommitData: (
		data: CampaignImportCommitData
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportCommitData'>>
	readCampaignImportCommitData: (
		campaignId: string,
		ingestionId: string
	) => Effect<CampaignImportCommitData, Failure<'ingestionStorage', 'readCampaignImportCommitData'>>
	writeCampaignImportCommitPlan: (
		data: CampaignImportCommitPlanData
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportCommitPlan'>>
	readCampaignImportCommitPlan: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportCommitPlanData | undefined,
		Failure<'ingestionStorage', 'readCampaignImportCommitPlan'>
	>
	writeCampaignImportCompletion: (
		data: CampaignImportCompletionData
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportCompletion'>>
	readCampaignImportCompletion: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportCompletionData | undefined,
		Failure<'ingestionStorage', 'readCampaignImportCompletion'>
	>
	readCommitJournal: NonNullable<IngestionStorage['readCommitJournal']>
	writeCommitJournal: NonNullable<IngestionStorage['writeCommitJournal']>
}

export type CampaignImportChronologyStorage = {
	writeCampaignImportChronologyDraft: (
		data: CampaignImportChronologyDraft
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportChronologyDraft'>>
	readCampaignImportChronologyDraft: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportChronologyDraft,
		Failure<'ingestionStorage', 'readCampaignImportChronologyDraft'>
	>
	writeCampaignImportChronologyCommitData: (
		data: CampaignImportChronologyCommitData
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportChronologyCommitData'>>
	readCampaignImportChronologyCommitData: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportChronologyCommitData,
		Failure<'ingestionStorage', 'readCampaignImportChronologyCommitData'>
	>
	writeCampaignImportChronologyCommitPlan: (
		data: CampaignImportChronologyCommitPlanData
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportChronologyCommitPlan'>>
	readCampaignImportChronologyCommitPlan: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportChronologyCommitPlanData | undefined,
		Failure<'ingestionStorage', 'readCampaignImportChronologyCommitPlan'>
	>
	writeCampaignImportChronologyCompletion: (
		data: CampaignImportChronologyCompletionData
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportChronologyCompletion'>>
	readCampaignImportChronologyCompletion: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportChronologyCompletionData | undefined,
		Failure<'ingestionStorage', 'readCampaignImportChronologyCompletion'>
	>
}

export type CampaignImportLifecycleStorage = {
	writeCampaignImportChronologyDispatch: (
		data: CampaignImportChronologyDispatchData
	) => Effect<void, Failure<'ingestionStorage', 'writeCampaignImportChronologyDispatch'>>
	readCampaignImportChronologyDispatch: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportChronologyDispatchData | undefined,
		Failure<'ingestionStorage', 'readCampaignImportChronologyDispatch'>
	>
	listCampaignImports: (
		campaignId: string
	) => Effect<CampaignImportSummary[], Failure<'ingestionStorage', 'listCampaignImports'>>
	discardCampaignImport: (
		campaignId: string,
		ingestionId: string
	) => Effect<void, Failure<'ingestionStorage', 'discardCampaignImport'>>
	readCampaignImportLifecycleState: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportLifecycleStorageState,
		Failure<'ingestionStorage', 'readCampaignImportLifecycleState'>
	>
}

export type CampaignImportCleanupStorage = {
	cleanupCampaignImport: (
		campaignId: string,
		ingestionId: string
	) => Effect<void, Failure<'ingestionStorage', 'cleanupCampaignImport'>>
	verifyCampaignImportSourceBodies: (
		campaignId: string,
		sources: CampaignImportSource[]
	) => Effect<void, Failure<'ingestionStorage', 'verifyCampaignImportSourceBodies'>>
	isCampaignImportCleanupVerified: (
		campaignId: string,
		ingestionId: string
	) => Effect<boolean, Failure<'ingestionStorage', 'isCampaignImportCleanupVerified'>>
	isCampaignImportCleanupStarted: (
		campaignId: string,
		ingestionId: string
	) => Effect<boolean, Failure<'ingestionStorage', 'isCampaignImportCleanupStarted'>>
	markCampaignImportCleanupStarted: (
		campaignId: string,
		ingestionId: string
	) => Effect<void, Failure<'ingestionStorage', 'markCampaignImportCleanupStarted'>>
	markCampaignImportCleanupVerified: (
		campaignId: string,
		ingestionId: string
	) => Effect<void, Failure<'ingestionStorage', 'markCampaignImportCleanupVerified'>>
	acquireCampaignImportOperationLease: (
		campaignId: string,
		ingestionId: string
	) => Effect<
		CampaignImportOperationLease,
		Failure<'ingestionStorage', 'acquireCampaignImportOperationLease'>
	>
	releaseCampaignImportOperationLease: (
		campaignId: string,
		ingestionId: string,
		lease: CampaignImportOperationLease
	) => Effect<void, Failure<'ingestionStorage', 'releaseCampaignImportOperationLease'>>
}

export type CampaignImportOperationLease = {
	ownerToken: string
}

export type CampaignImportStorage = CampaignImportAnalysisStorage &
	CampaignImportReviewStorage &
	CampaignImportBaseCommitStorage &
	CampaignImportChronologyStorage &
	CampaignImportLifecycleStorage &
	CampaignImportCleanupStorage

const ingestionsRoot = (rootPath: string, campaignId: string) =>
	resolve(rootPath, campaignId, '.loremaster', 'ingestions')

const ingestionRoot = (rootPath: string, campaignId: string, ingestionId: string) =>
	resolve(ingestionsRoot(rootPath, campaignId), ingestionId)

const isFileError = (cause: unknown, code: string) =>
	typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code

export class ImmutableIngestionConflictError extends Error {
	constructor() {
		super('Immutable ingestion data differs')
		this.name = 'ImmutableIngestionConflictError'
	}
}

export const isImmutableIngestionConflict = (
	cause: unknown
): cause is ImmutableIngestionConflictError =>
	cause instanceof ImmutableIngestionConflictError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'ImmutableIngestionConflictError')

export class CommitStartedIngestionDiscardError extends Error {
	constructor() {
		super('An ingestion cannot be discarded after its commit has started')
		this.name = 'CommitStartedIngestionDiscardError'
	}
}

export const isCommitStartedIngestionDiscard = (
	cause: unknown
): cause is CommitStartedIngestionDiscardError =>
	cause instanceof CommitStartedIngestionDiscardError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CommitStartedIngestionDiscardError')

export class CampaignImportSourceIntegrityError extends Error {
	constructor() {
		super('Campaign import source metadata does not match its content')
		this.name = 'CampaignImportSourceIntegrityError'
	}
}

export class CampaignImportReviewRevisionConflictError extends Error {
	constructor(
		readonly expectedRevision: number,
		readonly actualRevision: number
	) {
		super('Campaign import review state revision differs')
		this.name = 'CampaignImportReviewRevisionConflictError'
	}
}

export const isCampaignImportReviewRevisionConflict = (
	cause: unknown
): cause is CampaignImportReviewRevisionConflictError =>
	cause instanceof CampaignImportReviewRevisionConflictError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewRevisionConflictError')

export class CampaignImportReviewCommitConflictError extends Error {
	constructor(readonly reason: 'staleRevision' | 'selectionMismatch') {
		super('Campaign import commit does not match the acknowledged review state')
		this.name = 'CampaignImportReviewCommitConflictError'
	}
}

export const isCampaignImportReviewCommitConflict = (
	cause: unknown
): cause is CampaignImportReviewCommitConflictError =>
	cause instanceof CampaignImportReviewCommitConflictError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewCommitConflictError')

export class CampaignImportReviewLockedError extends Error {
	constructor() {
		super('Campaign import review state cannot change after commit starts')
		this.name = 'CampaignImportReviewLockedError'
	}
}

export const isCampaignImportReviewLocked = (
	cause: unknown
): cause is CampaignImportReviewLockedError =>
	cause instanceof CampaignImportReviewLockedError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewLockedError')

export class CampaignImportReviewLockBusyError extends Error {
	constructor() {
		super('Campaign import review state is being changed by another process')
		this.name = 'CampaignImportReviewLockBusyError'
	}
}

export const isCampaignImportReviewLockBusy = (
	cause: unknown
): cause is CampaignImportReviewLockBusyError =>
	cause instanceof CampaignImportReviewLockBusyError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewLockBusyError')

export class CampaignImportOperationLeaseBusyError extends Error {
	constructor() {
		super('Another campaign import operation is already in progress')
		this.name = 'CampaignImportOperationLeaseBusyError'
	}
}

export const isCampaignImportOperationLeaseBusy = (
	cause: unknown
): cause is CampaignImportOperationLeaseBusyError =>
	cause instanceof CampaignImportOperationLeaseBusyError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportOperationLeaseBusyError')

export class IncompleteCampaignImportCleanupError extends Error {
	constructor() {
		super('A campaign import cannot be cleaned up before it is complete')
		this.name = 'IncompleteCampaignImportCleanupError'
	}
}

export const isIncompleteCampaignImportCleanup = (
	cause: unknown
): cause is IncompleteCampaignImportCleanupError =>
	cause instanceof IncompleteCampaignImportCleanupError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'IncompleteCampaignImportCleanupError')

export class CampaignImportPermanenceError extends Error {
	constructor(readonly details: Record<string, unknown>) {
		super('Campaign import evidence is not permanently retained')
		this.name = 'CampaignImportPermanenceError'
	}
}

export const isCampaignImportPermanenceError = (
	cause: unknown
): cause is CampaignImportPermanenceError =>
	cause instanceof CampaignImportPermanenceError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportPermanenceError')

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

const writeImmutable = async (path: string, content: string) => {
	const temporaryPath = `${path}.${randomUUID()}.tmp`
	await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
	try {
		await link(temporaryPath, path)
	} catch (cause) {
		if (!isFileError(cause, 'EEXIST')) throw cause
		const existing = await readFile(path, 'utf8')
		if (existing !== content) throw new ImmutableIngestionConflictError()
	} finally {
		await unlink(temporaryPath)
	}
}

const writeIfAbsent = async (path: string, content: string) => {
	const temporaryPath = `${path}.${randomUUID()}.tmp`
	await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
	try {
		await link(temporaryPath, path)
	} catch (cause) {
		if (!isFileError(cause, 'EEXIST')) throw cause
	} finally {
		await unlink(temporaryPath)
	}
}

const writeAtomic = async (path: string, content: string) => {
	const temporaryPath = `${path}.${randomUUID()}.tmp`
	await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
	await rename(temporaryPath, path)
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

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

type OwnedFileLock = {
	ownerToken: string
	acquiredAt: string
	renewedAt?: string
}

const CAMPAIGN_IMPORT_REVIEW_LOCK_STALE_MS = 30_000
const CAMPAIGN_IMPORT_REVIEW_LOCK_HEARTBEAT_MS = 10_000
const CAMPAIGN_IMPORT_OPERATION_LEASE_MAX_WEB_OPERATION_STALE_MS = 30 * 60_000
const CAMPAIGN_IMPORT_REVIEW_LOCK_WAIT_MS = 500
const CAMPAIGN_IMPORT_REVIEW_LOCK_RETRY_MS = 10

class OwnedFileLockReleaseError extends Error {
	constructor() {
		super('File lock ownership changed before release')
		this.name = 'OwnedFileLockReleaseError'
	}
}

const ownedFileLeasePath = (path: string, ownerToken: string) => resolve(path, `${ownerToken}.json`)

const readOwnedFileLock = async (path: string): Promise<OwnedFileLock | undefined> => {
	try {
		const value = JSON.parse(await readFile(path, 'utf8')) as Partial<OwnedFileLock>
		return typeof value.ownerToken === 'string' && typeof value.acquiredAt === 'string'
			? (value as OwnedFileLock)
			: undefined
	} catch (cause) {
		if (isFileError(cause, 'ENOENT')) return undefined
		if (cause instanceof SyntaxError) return undefined
		throw cause
	}
}

const ownedFileLockIsStale = async (
	path: string,
	lock: OwnedFileLock | undefined,
	staleMs: number
): Promise<boolean> => {
	let metadata
	try {
		metadata = await stat(path)
	} catch (cause) {
		if (isFileError(cause, 'ENOENT')) return false
		throw cause
	}
	const contentTimestamp = lock?.renewedAt ?? lock?.acquiredAt
	const contentTime = contentTimestamp ? Date.parse(contentTimestamp) : Number.NaN
	const lastOwnedAt = Number.isFinite(contentTime)
		? Math.max(contentTime, metadata.mtimeMs)
		: metadata.mtimeMs
	return Date.now() - lastOwnedAt > staleMs
}

const releaseOwnedFileLock = async (path: string, ownerToken: string): Promise<void> => {
	const ownerPath = ownedFileLeasePath(path, ownerToken)
	const current = await readOwnedFileLock(ownerPath)
	if (current?.ownerToken !== ownerToken) throw new OwnedFileLockReleaseError()
	try {
		await unlink(ownerPath)
	} catch (cause) {
		if (!isFileError(cause, 'ENOENT')) throw cause
	}
	try {
		await rmdir(path)
	} catch (cause) {
		if (!isFileError(cause, 'ENOENT') && !isFileError(cause, 'ENOTEMPTY')) throw cause
	}
}

const renewOwnedFileLock = async (path: string, ownerToken: string): Promise<void> => {
	const ownerPath = ownedFileLeasePath(path, ownerToken)
	const current = await readOwnedFileLock(ownerPath)
	if (current?.ownerToken !== ownerToken) throw new OwnedFileLockReleaseError()
	await writeFile(ownerPath, json({ ...current, renewedAt: new Date().toISOString() }), {
		encoding: 'utf8',
		flag: 'r+'
	})
	const renewed = await readOwnedFileLock(ownerPath)
	if (renewed?.ownerToken !== ownerToken) throw new OwnedFileLockReleaseError()
}

const removeStaleOwnedFileLocks = async (
	path: string,
	ownerToken: string,
	staleMs: number
): Promise<boolean> => {
	let entries
	try {
		entries = await readdir(path, { withFileTypes: true })
	} catch (cause) {
		if (isFileError(cause, 'ENOENT')) return false
		throw cause
	}
	let hasFreshCompetitor = false
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.json')) continue
		if (entry.name === `${ownerToken}.json`) continue
		const competitorPath = resolve(path, entry.name)
		const competitor = await readOwnedFileLock(competitorPath)
		if (!(await ownedFileLockIsStale(competitorPath, competitor, staleMs))) {
			hasFreshCompetitor = true
			continue
		}
		try {
			await unlink(competitorPath)
		} catch (cause) {
			if (!isFileError(cause, 'ENOENT')) throw cause
		}
	}
	return hasFreshCompetitor
}

const acquireOwnedFileLock = async (
	path: string,
	{
		waitMs,
		staleMs,
		busyError
	}: {
		waitMs: number
		staleMs: number
		busyError: () => Error
	}
): Promise<OwnedFileLock> => {
	const deadline = Date.now() + waitMs
	const waitToRetry = async (ownerToken: string) => {
		if (Date.now() >= deadline) throw busyError()
		const retryDelay =
			1 + (Number.parseInt(ownerToken.slice(0, 8), 16) % CAMPAIGN_IMPORT_REVIEW_LOCK_RETRY_MS)
		await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelay, deadline - Date.now())))
	}
	while (true) {
		const lease = { ownerToken: randomUUID(), acquiredAt: new Date().toISOString() }
		await mkdir(path, { recursive: true })
		try {
			await writeFile(ownedFileLeasePath(path, lease.ownerToken), json(lease), {
				encoding: 'utf8',
				flag: 'wx'
			})
		} catch (cause) {
			if (isFileError(cause, 'ENOENT')) continue
			throw cause
		}
		if (await removeStaleOwnedFileLocks(path, lease.ownerToken, staleMs)) {
			await releaseOwnedFileLock(path, lease.ownerToken)
			await waitToRetry(lease.ownerToken)
			continue
		}
		return lease
	}
}

const withOwnedFileLockHeartbeat = async <Value>(
	path: string,
	lease: OwnedFileLock,
	operation: () => Promise<Value>
): Promise<Value> => {
	let stopped = false
	let heartbeat: Promise<void> | undefined
	let heartbeatError: unknown
	const timer = setInterval(() => {
		if (stopped || heartbeat) return
		heartbeat = renewOwnedFileLock(path, lease.ownerToken)
			.catch((cause) => {
				heartbeatError = cause
			})
			.finally(() => {
				heartbeat = undefined
			})
	}, CAMPAIGN_IMPORT_REVIEW_LOCK_HEARTBEAT_MS)
	try {
		const result = await operation()
		if (heartbeatError) throw heartbeatError
		return result
	} finally {
		stopped = true
		clearInterval(timer)
		await heartbeat
		await releaseOwnedFileLock(path, lease.ownerToken)
	}
}

const sortedUnique = (values: string[]) => [...new Set(values)].sort()

const campaignImportResolutionKey = (
	resolution: CampaignImportReviewState['resolutions'][number]
) =>
	resolution.kind === 'existing'
		? `${resolution.proposalId}\0${resolution.kind}\0${resolution.documentId}`
		: `${resolution.proposalId}\0${resolution.kind}`

export const filesystemIngestionStorage = (
	rootPath: string
): IngestionStorage & CampaignImportStorage => {
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
		const lease = await acquireOwnedFileLock(reviewLockPathFor(campaignId, ingestionId), {
			waitMs: CAMPAIGN_IMPORT_REVIEW_LOCK_WAIT_MS,
			staleMs: CAMPAIGN_IMPORT_REVIEW_LOCK_STALE_MS,
			busyError: () => new CampaignImportReviewLockBusyError()
		})
		return withOwnedFileLockHeartbeat(reviewLockPathFor(campaignId, ingestionId), lease, operation)
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

	const writeTranscriptData = (data: SessionTranscriptData) =>
		tryPromise({
			try: async () => {
				const root = rootFor(data.campaignId, data.ingestionId)
				await mkdir(root, { recursive: true })
				await Promise.all([
					writeImmutable(resolve(root, 'request.json'), json(data)),
					writeImmutable(resolve(root, 'transcript.txt'), data.transcript)
				])
			},
			catch: (cause) => failure('ingestionStorage', 'writeTranscriptData', cause)
		})

	const writeDraft = (draft: SessionIngestionDraft) =>
		tryPromise({
			try: async () => {
				const root = rootFor(draft.campaignId, draft.ingestionId)
				await mkdir(root, { recursive: true })
				await writeImmutable(resolve(root, 'analysis.json'), json(draft))
			},
			catch: (cause) => failure('ingestionStorage', 'writeDraft', cause)
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

	const fileExists = async (path: string) => {
		try {
			await access(path)
			return true
		} catch (cause) {
			if (isFileError(cause, 'ENOENT')) return false
			throw cause
		}
	}

	const readOptionalJson = async <Value>(path: string): Promise<Value | undefined> => {
		try {
			return JSON.parse(await readFile(path, 'utf8')) as Value
		} catch (cause) {
			if (isFileError(cause, 'ENOENT')) return undefined
			throw cause
		}
	}

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
			const cause = new Error('Campaign import was not found')
			cause.name = 'CampaignImportNotFoundError'
			throw cause
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
		write: (draft, transcript) =>
			tryPromise({
				try: async () => {
					const root = rootFor(draft.campaignId, draft.ingestionId)
					await mkdir(root, { recursive: true })
					const data: SessionTranscriptData = {
						schemaVersion: 1,
						ingestionId: draft.ingestionId,
						campaignId: draft.campaignId,
						title: draft.title,
						transcript
					}
					await Promise.all([
						writeImmutable(resolve(root, 'request.json'), json(data)),
						writeImmutable(resolve(root, 'transcript.txt'), transcript),
						writeImmutable(resolve(root, 'analysis.json'), json(draft))
					])
				},
				catch: (cause) => failure('ingestionStorage', 'write', cause)
			}),
		writeTranscriptData,
		readTranscriptData: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'request.json', 'readTranscriptData'),
		writeDraft,
		read: (campaignId, ingestionId) => readJson(campaignId, ingestionId, 'analysis.json', 'read'),
		readTranscript: (campaignId, ingestionId) =>
			tryPromise({
				try: () => readFile(resolve(rootFor(campaignId, ingestionId), 'transcript.txt'), 'utf8'),
				catch: (cause) => failure('ingestionStorage', 'readTranscript', cause)
			}),
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
					readOptionalJson<CampaignImportCommitPlanData>(
						resolve(rootFor(campaignId, ingestionId), 'import-commit-plan.json')
					),
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
					readOptionalJson<CampaignImportCompletionData>(
						resolve(rootFor(campaignId, ingestionId), 'import-completion.json')
					),
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
					readOptionalJson<CampaignImportChronologyDispatchData>(
						resolve(rootFor(campaignId, ingestionId), 'chronology-dispatch.json')
					),
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
					readOptionalJson<CampaignImportChronologyCommitPlanData>(
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
					readOptionalJson<CampaignImportChronologyCompletionData>(
						resolve(rootFor(campaignId, ingestionId), 'chronology-completion.json')
					),
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
						busyError: () => new CampaignImportOperationLeaseBusyError()
					}),
				catch: (cause) => failure('ingestionStorage', 'acquireCampaignImportOperationLease', cause)
			}),
		releaseCampaignImportOperationLease: (campaignId, ingestionId, lease) =>
			tryPromise({
				try: () =>
					releaseOwnedFileLock(operationLeasePathFor(campaignId, ingestionId), lease.ownerToken),
				catch: (cause) => failure('ingestionStorage', 'releaseCampaignImportOperationLease', cause)
			}),
		writeCommitData: (data) =>
			tryPromise({
				try: async () => {
					const root = rootFor(data.campaignId, data.ingestionId)
					await mkdir(root, { recursive: true })
					await writeImmutable(resolve(root, 'commit-request.json'), json(data))
				},
				catch: (cause) => failure('ingestionStorage', 'writeCommitData', cause)
			}),
		readCommitData: (campaignId, ingestionId) =>
			readJson(campaignId, ingestionId, 'commit-request.json', 'readCommitData'),
		readCommitJournal: (campaignId, ingestionId) =>
			tryPromise({
				try: async () => {
					try {
						return JSON.parse(
							await readFile(
								resolve(rootFor(campaignId, ingestionId), 'commit-journal.json'),
								'utf8'
							)
						) as SessionCommitJournal
					} catch (cause) {
						if (isFileError(cause, 'ENOENT')) return undefined
						throw cause
					}
				},
				catch: (cause) => failure('ingestionStorage', 'readCommitJournal', cause)
			}),
		writeCommitJournal: (journal) =>
			tryPromise({
				try: async () => {
					const root = rootFor(journal.campaignId, journal.ingestionId)
					await mkdir(root, { recursive: true })
					await writeAtomic(resolve(root, 'commit-journal.json'), json(journal))
				},
				catch: (cause) => failure('ingestionStorage', 'writeCommitJournal', cause)
			}),
		list: (campaignId) =>
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
							.map(async (entry): Promise<SessionIngestionSummary | undefined> => {
								const root = rootFor(campaignId, entry.name)
								const requestPath = resolve(root, 'request.json')
								const transcriptData = await readOptionalJson<SessionTranscriptData>(requestPath)
								if (
									!transcriptData ||
									('kind' in transcriptData && transcriptData.kind === 'campaign-import') ||
									transcriptData.campaignId !== campaignId ||
									transcriptData.ingestionId !== entry.name
								)
									return undefined
								const [draft, commitStarted, requestStat] = await Promise.all([
									readOptionalJson<SessionIngestionDraft>(resolve(root, 'analysis.json')),
									fileExists(resolve(root, 'commit-request.json')),
									stat(requestPath)
								])
								return {
									ingestionId: transcriptData.ingestionId,
									campaignId,
									title: transcriptData.title,
									createdAt: draft?.createdAt ?? requestStat.mtime.toISOString(),
									phase: commitStarted ? 'committing' : draft ? 'review' : 'analyzing',
									canDiscard: !commitStarted
								}
							})
					)
					return summaries
						.filter((summary): summary is SessionIngestionSummary => Boolean(summary))
						.sort(
							(left, right) =>
								right.createdAt.localeCompare(left.createdAt) ||
								left.ingestionId.localeCompare(right.ingestionId)
						)
				},
				catch: (cause) => failure('ingestionStorage', 'list', cause)
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
								const requestPath = resolve(root, 'request.json')
								const request = await readOptionalJson<CampaignImportRequestData>(requestPath)
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
		discard: (campaignId, ingestionId) =>
			tryPromise({
				try: async () => {
					const root = rootFor(campaignId, ingestionId)
					if (await fileExists(resolve(root, 'commit-request.json'))) {
						throw new CommitStartedIngestionDiscardError()
					}
					await rm(root, { recursive: true, force: true })
				},
				catch: (cause) => failure('ingestionStorage', 'discard', cause)
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
