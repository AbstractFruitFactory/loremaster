import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { tryPromise } from 'effect/Effect'
import { failure } from '../failure.js'
import { objectIngestionStorage } from '../ingestion/object-storage.js'
import type { VaultRevision } from '../vault/revisions/types.js'
import {
	comparableRevision,
	orderRevisionChain,
	type RevisionStorage
} from '../vault/revisions/storage.js'
import type { VaultStorage } from '../vault/storage/storage.js'
import type { StorageAdapter } from './adapter.js'

export type SupabaseStorageConfig = {
	url: string
	serviceRoleKey: string
	bucket?: string
}

type StorageError = Error & { code?: string; statusCode?: string }

const asStorageError = (cause: unknown, fallbackMessage: string): StorageError => {
	if (cause instanceof Error) return cause as StorageError
	const error = new Error(
		typeof cause === 'object' && cause !== null && 'message' in cause
			? String(cause.message)
			: fallbackMessage
	) as StorageError
	if (typeof cause === 'object' && cause !== null && 'statusCode' in cause) {
		error.statusCode = String(cause.statusCode)
	}
	return error
}

const withCode = (cause: unknown, code: string, fallbackMessage: string) => {
	const error = asStorageError(cause, fallbackMessage)
	error.code = code
	return error
}

const isMissing = (cause: unknown) => {
	if (typeof cause !== 'object' || cause === null) return false
	const status = 'statusCode' in cause ? String(cause.statusCode) : ''
	const message = 'message' in cause ? String(cause.message).toLowerCase() : ''
	return status === '404' || message.includes('not found') || message.includes('does not exist')
}

const isConflict = (cause: unknown) => {
	if (typeof cause !== 'object' || cause === null) return false
	const status = 'statusCode' in cause ? String(cause.statusCode) : ''
	const message = 'message' in cause ? String(cause.message).toLowerCase() : ''
	return status === '409' || message.includes('already exists') || message.includes('duplicate')
}

const normalizePrefix = (prefix: string) => prefix.replace(/^\/+|\/+$/gu, '')

export const createSupabaseStorageClient = ({
	url,
	serviceRoleKey
}: SupabaseStorageConfig): SupabaseClient =>
	createClient(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	})

export const supabaseObjectStorage = (
	client: SupabaseClient,
	{ bucket = 'campaign-vaults', prefix = '' }: { bucket?: string; prefix?: string } = {}
) => {
	const normalizedPrefix = normalizePrefix(prefix)
	let bucketReady: Promise<void> | undefined

	const ensureBucket = () => {
		bucketReady ??= (async () => {
			const { data, error } = await client.storage.getBucket(bucket)
			if (data && !error) return
			if (error && !isMissing(error))
				throw asStorageError(error, 'Unable to inspect storage bucket')

			const { error: createError } = await client.storage.createBucket(bucket, {
				public: false,
				fileSizeLimit: '10MB'
			})
			if (createError && !isConflict(createError)) {
				throw asStorageError(createError, 'Unable to create storage bucket')
			}
		})().catch((cause) => {
			bucketReady = undefined
			throw cause
		})
		return bucketReady
	}

	const objectPath = (path: string) =>
		[normalizedPrefix, normalizePrefix(path)].filter(Boolean).join('/')

	const read = async (path: string) => {
		await ensureBucket()
		const { data, error } = await client.storage.from(bucket).download(objectPath(path))
		if (error) {
			throw isMissing(error)
				? withCode(error, 'ENOENT', `Storage object ${path} does not exist`)
				: asStorageError(error, `Unable to read storage object ${path}`)
		}
		return data.text()
	}

	const put = async (path: string, content: string, upsert: boolean) => {
		await ensureBucket()
		const { error } = await client.storage.from(bucket).upload(objectPath(path), content, {
			contentType: path.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8',
			upsert
		})
		if (error) {
			throw !upsert && isConflict(error)
				? withCode(error, 'EEXIST', `Storage object ${path} already exists`)
				: asStorageError(error, `Unable to write storage object ${path}`)
		}
	}

	const remove = async (path: string) => {
		await ensureBucket()
		const { error } = await client.storage.from(bucket).remove([objectPath(path)])
		if (error) throw asStorageError(error, `Unable to delete storage object ${path}`)
	}

	const list = async (path = '') => {
		await ensureBucket()
		const root = objectPath(path)
		const objects: string[] = []
		const visit = async (directory: string): Promise<void> => {
			for (let offset = 0; ; offset += 1000) {
				const { data, error } = await client.storage.from(bucket).list(directory, {
					limit: 1000,
					offset,
					sortBy: { column: 'name', order: 'asc' }
				})
				if (error) throw asStorageError(error, `Unable to list storage objects under ${path}`)
				for (const entry of data) {
					const entryPath = [directory, entry.name].filter(Boolean).join('/')
					if (entry.id === null) await visit(entryPath)
					else objects.push(entryPath)
				}
				if (data.length < 1000) break
			}
		}
		await visit(root)
		const relativePrefix = root ? `${root}/` : ''
		return objects.map((path) => path.slice(relativePrefix.length))
	}

	return {
		ensureBucket,
		read,
		create: (path: string, content: string) => put(path, content, false),
		write: (path: string, content: string) => put(path, content, true),
		delete: remove,
		list
	}
}

export type SupabaseObjectStorage = ReturnType<typeof supabaseObjectStorage>

const assertSegment = (value: string, name: string) => {
	if (!value || value === '.' || value === '..' || /[/\\]/u.test(value)) {
		throw Error(`Invalid ${name}`)
	}
}

const vaultPath = (campaignId: string, path = '') => {
	assertSegment(campaignId, 'campaign ID')
	if (
		path &&
		(path.startsWith('/') ||
			path.includes('\\') ||
			path.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
	) {
		throw Error('Document path escapes the campaign vault')
	}
	return [campaignId, 'vault', path].filter(Boolean).join('/')
}

const revisionRoot = (campaignId: string, documentId?: string) => {
	assertSegment(campaignId, 'campaign ID')
	if (documentId) assertSegment(documentId, 'document ID')
	return [campaignId, 'revisions', documentId].filter(Boolean).join('/')
}

const revisionPath = (campaignId: string, documentId: string, revisionId: string) => {
	assertSegment(revisionId, 'revision ID')
	return `${revisionRoot(campaignId, documentId)}/${revisionId}.json`
}

const parseRevision = (source: string) => JSON.parse(source) as VaultRevision

const vaultStorage = (objects: SupabaseObjectStorage): VaultStorage => ({
	read: (campaignId, path) =>
		tryPromise({
			try: () => objects.read(vaultPath(campaignId, path)),
			catch: (cause) => failure('vaultStorage', 'readDocument', cause)
		}),
	write: (campaignId, path, content) =>
		tryPromise({
			try: () => objects.write(vaultPath(campaignId, path), content),
			catch: (cause) => failure('vaultStorage', 'writeDocument', cause)
		}),
	create: (campaignId, path, content) =>
		tryPromise({
			try: () => objects.create(vaultPath(campaignId, path), content),
			catch: (cause) => failure('vaultStorage', 'createDocument', cause)
		}),
	delete: (campaignId, path) =>
		tryPromise({
			try: () => objects.delete(vaultPath(campaignId, path)),
			catch: (cause) => failure('vaultStorage', 'deleteDocument', cause)
		}),
	list: (campaignId) =>
		tryPromise({
			try: async () =>
				(await objects.list(vaultPath(campaignId))).filter((path) =>
					path.toLowerCase().endsWith('.md')
				),
			catch: (cause) => failure('vaultStorage', 'listDocuments', cause)
		})
})

const revisionStorage = (objects: SupabaseObjectStorage): RevisionStorage => ({
	write: (revision) =>
		tryPromise({
			try: async () => {
				const path = revisionPath(revision.campaignId, revision.documentId, revision.revisionId)
				try {
					await objects.create(path, `${JSON.stringify(revision, null, 2)}\n`)
					return revision
				} catch (cause) {
					if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') {
						throw cause
					}
					const existing = parseRevision(await objects.read(path))
					if (
						JSON.stringify(comparableRevision(existing)) !==
						JSON.stringify(comparableRevision(revision))
					) {
						throw Error('Stored revision differs from deterministic revision')
					}
					return existing
				}
			},
			catch: (cause) => failure('revisionStorage', 'writeRevision', cause)
		}),
	getRevision: (campaignId, documentId, revisionId) =>
		tryPromise({
			try: async () =>
				parseRevision(await objects.read(revisionPath(campaignId, documentId, revisionId))),
			catch: (cause) => failure('revisionStorage', 'getRevision', cause)
		}),
	listDocumentRevisions: (campaignId, documentId) =>
		tryPromise({
			try: async () => {
				const root = revisionRoot(campaignId, documentId)
				return orderRevisionChain(
					await Promise.all(
						(await objects.list(root))
							.filter((path) => path.endsWith('.json'))
							.map(async (path) => parseRevision(await objects.read(`${root}/${path}`)))
					)
				)
			},
			catch: (cause) => failure('revisionStorage', 'listDocumentRevisions', cause)
		}),
	listCampaignRevisions: (campaignId) =>
		tryPromise({
			try: async () => {
				const root = revisionRoot(campaignId)
				return Promise.all(
					(await objects.list(root))
						.filter((path) => path.endsWith('.json'))
						.map(async (path) => parseRevision(await objects.read(`${root}/${path}`)))
				)
			},
			catch: (cause) => failure('revisionStorage', 'listCampaignRevisions', cause)
		})
})

export const createSupabaseStorageAdapter = (objects: SupabaseObjectStorage): StorageAdapter => ({
	vault: vaultStorage(objects),
	revisions: revisionStorage(objects),
	ingestion: objectIngestionStorage(objects)
})

export const supabaseStorageAdapter = (config: SupabaseStorageConfig): StorageAdapter =>
	createSupabaseStorageAdapter(
		supabaseObjectStorage(createSupabaseStorageClient(config), {
			bucket: config.bucket,
			prefix: 'campaigns'
		})
	)
