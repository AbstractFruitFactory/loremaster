import { randomUUID } from 'node:crypto'
import {
	access,
	link,
	mkdir,
	readFile,
	readdir,
	rename,
	rmdir,
	stat,
	unlink,
	writeFile
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { ImmutableIngestionConflictError } from './storage-errors.js'

export const ingestionsRoot = (rootPath: string, campaignId: string) =>
	resolve(rootPath, campaignId, '.loremaster', 'ingestions')

export const ingestionRoot = (rootPath: string, campaignId: string, ingestionId: string) =>
	resolve(ingestionsRoot(rootPath, campaignId), ingestionId)

export const isFileError = (cause: unknown, code: string) =>
	typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code

export const json = (value: unknown) => JSON.stringify(value, null, 2)

export const writeImmutable = async (path: string, content: string) => {
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

export const writeIfAbsent = async (path: string, content: string) => {
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

export const writeAtomic = async (path: string, content: string) => {
	const temporaryPath = `${path}.${randomUUID()}.tmp`
	await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
	await rename(temporaryPath, path)
}

export const fileExists = async (path: string) => {
	try {
		await access(path)
		return true
	} catch (cause) {
		if (isFileError(cause, 'ENOENT')) return false
		throw cause
	}
}

export const readOptionalJson = async <Value>(path: string): Promise<Value | undefined> => {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as Value
	} catch (cause) {
		if (isFileError(cause, 'ENOENT')) return undefined
		throw cause
	}
}

export type OwnedFileLock = {
	ownerToken: string
	acquiredAt: string
	renewedAt?: string
}

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

export const releaseOwnedFileLock = async (path: string, ownerToken: string): Promise<void> => {
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

export const acquireOwnedFileLock = async (
	path: string,
	{
		waitMs,
		staleMs,
		busyError,
		retryMs
	}: {
		waitMs: number
		staleMs: number
		busyError: () => Error
		retryMs: number
	}
): Promise<OwnedFileLock> => {
	const deadline = Date.now() + waitMs
	const waitToRetry = async (ownerToken: string) => {
		if (Date.now() >= deadline) throw busyError()
		const retryDelay = 1 + (Number.parseInt(ownerToken.slice(0, 8), 16) % retryMs)
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

export const withOwnedFileLockHeartbeat = async <Value>(
	path: string,
	lease: OwnedFileLock,
	operation: () => Promise<Value>,
	heartbeatMs: number
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
	}, heartbeatMs)
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
