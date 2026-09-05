import { access, link, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../../failure'
import type { RevisionTransactionManifest, VaultRevision } from './types'

type RevisionStorageFailure<Operation extends string> = Failure<'revisionStorage', Operation>

export type RevisionStorage = {
	prepare: (
		manifest: RevisionTransactionManifest,
		revision: VaultRevision
	) => Effect<void, RevisionStorageFailure<'prepareTransaction'>>
	markCanonCommitted: (
		campaignId: string,
		transactionId: string
	) => Effect<void, RevisionStorageFailure<'markCanonCommitted'>>
	promote: (
		campaignId: string,
		transactionId: string
	) => Effect<void, RevisionStorageFailure<'promoteRevision'>>
	markCommitted: (
		campaignId: string,
		transactionId: string
	) => Effect<void, RevisionStorageFailure<'markTransactionCommitted'>>
	markAborted: (
		campaignId: string,
		transactionId: string
	) => Effect<void, RevisionStorageFailure<'markTransactionAborted'>>
	markConflicted: (
		campaignId: string,
		transactionId: string
	) => Effect<void, RevisionStorageFailure<'markTransactionConflicted'>>
	getRevision: (
		campaignId: string,
		documentId: string,
		revisionId: string
	) => Effect<VaultRevision, RevisionStorageFailure<'getRevision'>>
	listDocumentRevisions: (
		campaignId: string,
		documentId: string
	) => Effect<VaultRevision[], RevisionStorageFailure<'listDocumentRevisions'>>
	listCampaignRevisions: (
		campaignId: string
	) => Effect<VaultRevision[], RevisionStorageFailure<'listCampaignRevisions'>>
	listTransactions: (
		campaignId: string
	) => Effect<RevisionTransactionManifest[], RevisionStorageFailure<'listTransactions'>>
	getTransactionStatus: (
		campaignId: string,
		transactionId: string
	) => Effect<
		'prepared' | 'canon-committed' | 'committed' | 'aborted' | 'conflicted',
		RevisionStorageFailure<'getTransactionStatus'>
	>
}

const assertSegment = (value: string, name: string) => {
	if (!value || value === '.' || value === '..' || /[/\\]/.test(value)) {
		throw Error(`Invalid ${name}`)
	}
}

const resolveInside = (base: string, ...segments: string[]) => {
	const target = resolve(base, ...segments)
	const path = relative(base, target)
	if (path === '..' || path.startsWith(`..${sep}`) || path.startsWith(sep)) {
		throw Error('Revision path escapes campaign metadata')
	}
	return target
}

const exists = async (path: string) => {
	try {
		await access(path)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
		throw error
	}
}

const readJson = async <Value>(path: string): Promise<Value> =>
	JSON.parse(await readFile(path, 'utf8')) as Value

const writeJsonExclusive = async (path: string, value: unknown) => {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'wx'
	})
}

export const filesystemRevisionStorage = (rootPath: string): RevisionStorage => {
	const root = resolve(rootPath)
	const metadataRoot = (campaignId: string) => {
		assertSegment(campaignId, 'campaign ID')
		return resolveInside(root, campaignId, '.loremaster')
	}
	const transactionRoot = (campaignId: string, transactionId: string) => {
		assertSegment(transactionId, 'transaction ID')
		return resolveInside(metadataRoot(campaignId), 'transactions', transactionId)
	}
	const revisionPath = (campaignId: string, documentId: string, revisionId: string) => {
		assertSegment(documentId, 'document ID')
		assertSegment(revisionId, 'revision ID')
		return resolveInside(metadataRoot(campaignId), 'revisions', documentId, `${revisionId}.json`)
	}
	const markerPath = (campaignId: string, transactionId: string, marker: string) =>
		resolveInside(transactionRoot(campaignId, transactionId), marker)

	const prepare: RevisionStorage['prepare'] = (manifest, revision) =>
		tryPromise({
			try: async () => {
				if (
					manifest.transactionId !== revision.transactionId ||
					manifest.revisionId !== revision.revisionId ||
					manifest.campaignId !== revision.campaignId
				) {
					throw Error('Revision does not match its transaction manifest')
				}
				const directory = transactionRoot(manifest.campaignId, manifest.transactionId)
				await mkdir(directory, { recursive: true })
				await writeJsonExclusive(resolveInside(directory, 'manifest.json'), manifest)
				await writeJsonExclusive(resolveInside(directory, 'revision.json'), revision)
			},
			catch: (cause) => failure('revisionStorage', 'prepareTransaction', cause)
		})

	const writeMarker =
		<Operation extends string>(marker: string, operation: Operation) =>
		(campaignId: string, transactionId: string) =>
			tryPromise({
				try: async () => {
					const path = markerPath(campaignId, transactionId, marker)
					await mkdir(dirname(path), { recursive: true })
					await writeFile(path, '', { flag: 'a' })
				},
				catch: (cause) => failure('revisionStorage', operation, cause)
			})

	const promote: RevisionStorage['promote'] = (campaignId, transactionId) =>
		tryPromise({
			try: async () => {
				const directory = transactionRoot(campaignId, transactionId)
				const staged = resolveInside(directory, 'revision.json')
				const revision = await readJson<VaultRevision>(staged)
				const destination = revisionPath(campaignId, revision.documentId, revision.revisionId)
				await mkdir(dirname(destination), { recursive: true })
				try {
					await link(staged, destination)
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
					const [stagedBytes, currentBytes] = await Promise.all([
						readFile(staged),
						readFile(destination)
					])
					if (!stagedBytes.equals(currentBytes)) {
						throw Error('Immutable revision already exists with different content')
					}
				}
			},
			catch: (cause) => failure('revisionStorage', 'promoteRevision', cause)
		})

	const getTransactionStatus: RevisionStorage['getTransactionStatus'] = (
		campaignId,
		transactionId
	) =>
		tryPromise({
			try: async () => {
				const directory = transactionRoot(campaignId, transactionId)
				if (await exists(resolveInside(directory, 'committed'))) return 'committed'
				if (await exists(resolveInside(directory, 'conflicted'))) return 'conflicted'
				if (await exists(resolveInside(directory, 'aborted'))) return 'aborted'
				if (await exists(resolveInside(directory, 'canon-committed'))) return 'canon-committed'
				return 'prepared'
			},
			catch: (cause) => failure('revisionStorage', 'getTransactionStatus', cause)
		})

	const isCommitted = async (campaignId: string, transactionId: string) =>
		exists(markerPath(campaignId, transactionId, 'committed'))

	const getRevision: RevisionStorage['getRevision'] = (campaignId, documentId, revisionId) =>
		tryPromise({
			try: async () => {
				const revision = await readJson<VaultRevision>(
					revisionPath(campaignId, documentId, revisionId)
				)
				if (!(await isCommitted(campaignId, revision.transactionId))) {
					throw Error('Revision transaction is not committed')
				}
				return revision
			},
			catch: (cause) => failure('revisionStorage', 'getRevision', cause)
		})

	const listRevisionFiles = async (campaignId: string, documentId?: string) => {
		const revisionsRoot = resolveInside(metadataRoot(campaignId), 'revisions')
		try {
			if (documentId) {
				assertSegment(documentId, 'document ID')
				const directory = resolveInside(revisionsRoot, documentId)
				return (await readdir(directory, { withFileTypes: true }))
					.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
					.map((entry) => resolveInside(directory, entry.name))
			}
			const documentDirectories = await readdir(revisionsRoot, { withFileTypes: true })
			const files = await Promise.all(
				documentDirectories
					.filter((entry) => entry.isDirectory())
					.map(async (entry) => {
						const directory = resolveInside(revisionsRoot, entry.name)
						return (await readdir(directory, { withFileTypes: true }))
							.filter((child) => child.isFile() && child.name.endsWith('.json'))
							.map((child) => resolveInside(directory, child.name))
					})
			)
			return files.flat()
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
			throw error
		}
	}

	const orderRevisionChain = (documentRevisions: VaultRevision[]) => {
		if (!documentRevisions.length) return []
		const byId = new Map(documentRevisions.map((revision) => [revision.revisionId, revision]))
		if (byId.size !== documentRevisions.length) throw Error('Duplicate revision IDs')
		const referenced = new Set(
			documentRevisions.flatMap(({ previousRevisionId }) =>
				previousRevisionId ? [previousRevisionId] : []
			)
		)
		const tips = documentRevisions.filter(({ revisionId }) => !referenced.has(revisionId))
		if (tips.length !== 1) {
			throw Error(`Ambiguous revision history has ${tips.length} tips`)
		}
		const chain: VaultRevision[] = []
		const visited = new Set<string>()
		let current: VaultRevision | undefined = tips[0]
		while (current) {
			if (visited.has(current.revisionId)) throw Error('Revision history contains a cycle')
			visited.add(current.revisionId)
			chain.push(current)
			if (!current.previousRevisionId) break
			current = byId.get(current.previousRevisionId)
			if (!current) throw Error('Revision history references a missing predecessor')
		}
		if (visited.size !== documentRevisions.length) {
			throw Error('Revision history contains disconnected branches')
		}
		return chain.reverse()
	}

	const listRevisions = async (campaignId: string, documentId?: string) => {
		const revisions = await Promise.all(
			(await listRevisionFiles(campaignId, documentId)).map((path) => readJson<VaultRevision>(path))
		)
		const committed = []
		for (const revision of revisions) {
			if (await isCommitted(campaignId, revision.transactionId)) committed.push(revision)
		}
		if (documentId) return orderRevisionChain(committed)
		const byDocument = new Map<string, VaultRevision[]>()
		for (const revision of committed) {
			const documentRevisions = byDocument.get(revision.documentId) ?? []
			documentRevisions.push(revision)
			byDocument.set(revision.documentId, documentRevisions)
		}
		return [...byDocument.values()]
			.flatMap(orderRevisionChain)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
	}

	const listTransactions: RevisionStorage['listTransactions'] = (campaignId) =>
		tryPromise({
			try: async () => {
				const transactionsRoot = resolveInside(metadataRoot(campaignId), 'transactions')
				try {
					const entries = await readdir(transactionsRoot, { withFileTypes: true })
					const manifests = await Promise.all(
						entries
							.filter((entry) => entry.isDirectory())
							.map((entry) =>
								readJson<RevisionTransactionManifest>(
									resolveInside(transactionsRoot, entry.name, 'manifest.json')
								)
							)
					)
					return manifests
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
					throw error
				}
			},
			catch: (cause) => failure('revisionStorage', 'listTransactions', cause)
		})

	return {
		prepare,
		markCanonCommitted: writeMarker('canon-committed', 'markCanonCommitted'),
		promote,
		markCommitted: writeMarker('committed', 'markTransactionCommitted'),
		markAborted: writeMarker('aborted', 'markTransactionAborted'),
		markConflicted: writeMarker('conflicted', 'markTransactionConflicted'),
		getRevision,
		listDocumentRevisions: (campaignId, documentId) =>
			tryPromise({
				try: () => listRevisions(campaignId, documentId),
				catch: (cause) => failure('revisionStorage', 'listDocumentRevisions', cause)
			}),
		listCampaignRevisions: (campaignId) =>
			tryPromise({
				try: () => listRevisions(campaignId),
				catch: (cause) => failure('revisionStorage', 'listCampaignRevisions', cause)
			}),
		listTransactions,
		getTransactionStatus
	}
}
