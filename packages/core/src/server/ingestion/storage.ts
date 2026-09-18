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
	stat,
	unlink,
	writeFile
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../failure.js'
import type {
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

const writeAtomic = async (path: string, content: string) => {
	const temporaryPath = `${path}.${randomUUID()}.tmp`
	await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
	await rename(temporaryPath, path)
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

export const filesystemIngestionStorage = (rootPath: string): IngestionStorage => {
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
