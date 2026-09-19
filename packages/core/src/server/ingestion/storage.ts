import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../failure.js'
import { filesystemCampaignImportStorage } from './campaign-import-storage.js'
import {
	fileExists,
	ingestionRoot,
	ingestionsRoot,
	isFileError,
	json,
	readOptionalJson,
	writeAtomic,
	writeImmutable
} from './filesystem-persistence.js'
import { CommitStartedIngestionDiscardError } from './storage-errors.js'
import type {
	CampaignImportChronologyCommitData,
	CampaignImportChronologyCommitPlanData,
	CampaignImportChronologyCompletionData,
	CampaignImportChronologyDispatchData,
	CampaignImportChronologyDraft,
	CampaignImportCommitData,
	CampaignImportCommitPlanData,
	CampaignImportCompletionData,
	CampaignImportDraft,
	CampaignImportLifecycleStorageState,
	CampaignImportRequestData,
	CampaignImportReviewState,
	CampaignImportSource,
	CampaignImportSourceData,
	CampaignImportSummary,
	SessionCommitData,
	SessionCommitJournal,
	SessionIngestionDraft,
	SessionIngestionSummary,
	SessionTranscriptData
} from './types.js'

export * from './storage-errors.js'

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

type SessionFilesystemStorage = IngestionStorage & {
	readCommitJournal: NonNullable<IngestionStorage['readCommitJournal']>
	writeCommitJournal: NonNullable<IngestionStorage['writeCommitJournal']>
}

const filesystemSessionIngestionStorage = (rootPath: string): SessionFilesystemStorage => {
	const rootFor = (campaignId: string, ingestionId: string) =>
		ingestionRoot(rootPath, campaignId, ingestionId)

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
			})
	}
}

export const filesystemIngestionStorage = (
	rootPath: string
): IngestionStorage & CampaignImportStorage => ({
	...filesystemSessionIngestionStorage(rootPath),
	...filesystemCampaignImportStorage(rootPath)
})
