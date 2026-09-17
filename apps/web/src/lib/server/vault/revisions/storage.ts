import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../../failure'
import type { VaultRevision } from './types'

type RevisionStorageFailure<Operation extends string> = Failure<'revisionStorage', Operation>

export type RevisionStorage = {
	write: (revision: VaultRevision) => Effect<void, RevisionStorageFailure<'writeRevision'>>
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
}

const assertSegment = (value: string, name: string) => {
	if (!value || value === '.' || value === '..' || /[/\\]/.test(value))
		throw Error(`Invalid ${name}`)
}

const resolveInside = (base: string, ...segments: string[]) => {
	const target = resolve(base, ...segments)
	const path = relative(base, target)
	if (path === '..' || path.startsWith(`..${sep}`) || path.startsWith(sep)) {
		throw Error('Revision path escapes campaign metadata')
	}
	return target
}

const readJson = async <Value>(path: string): Promise<Value> =>
	JSON.parse(await readFile(path, 'utf8')) as Value

const orderRevisionChain = (revisions: VaultRevision[]) => {
	if (revisions.length <= 1) return revisions
	const byId = new Map<string, VaultRevision>()
	const referenced = new Set<string>()
	for (const revision of revisions) {
		if (byId.has(revision.revisionId)) throw Error('Duplicate revision ID')
		byId.set(revision.revisionId, revision)
		if (revision.previousRevisionId) referenced.add(revision.previousRevisionId)
	}
	const tips = revisions.filter((revision) => !referenced.has(revision.revisionId))
	if (tips.length !== 1) throw Error('Revision history has multiple tips')
	const ordered: VaultRevision[] = []
	const visited = new Set<string>()
	let current: VaultRevision | undefined = tips[0]
	while (current) {
		if (visited.has(current.revisionId)) throw Error('Revision history contains a cycle')
		visited.add(current.revisionId)
		ordered.push(current)
		if (!current.previousRevisionId) break
		current = byId.get(current.previousRevisionId)
		if (!current) throw Error('Revision history has a missing predecessor')
	}
	if (ordered.length !== revisions.length) throw Error('Revision history is disconnected')
	return ordered.reverse()
}

export const filesystemRevisionStorage = (rootPath: string): RevisionStorage => {
	const root = resolve(rootPath)
	const metadataRoot = (campaignId: string) => {
		assertSegment(campaignId, 'campaign ID')
		return resolveInside(root, campaignId, '.loremaster')
	}
	const revisionPath = (campaignId: string, documentId: string, revisionId: string) => {
		assertSegment(documentId, 'document ID')
		assertSegment(revisionId, 'revision ID')
		return resolveInside(metadataRoot(campaignId), 'revisions', documentId, `${revisionId}.json`)
	}

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
			const directories = await readdir(revisionsRoot, { withFileTypes: true })
			const files = await Promise.all(
				directories
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

	return {
		write: (revision) =>
			tryPromise({
				try: async () => {
					const path = revisionPath(revision.campaignId, revision.documentId, revision.revisionId)
					await mkdir(dirname(path), { recursive: true })
					await writeFile(path, `${JSON.stringify(revision, null, 2)}\n`, {
						encoding: 'utf8',
						flag: 'wx'
					})
				},
				catch: (cause) => failure('revisionStorage', 'writeRevision', cause)
			}),
		getRevision: (campaignId, documentId, revisionId) =>
			tryPromise({
				try: () => readJson<VaultRevision>(revisionPath(campaignId, documentId, revisionId)),
				catch: (cause) => failure('revisionStorage', 'getRevision', cause)
			}),
		listDocumentRevisions: (campaignId, documentId) =>
			tryPromise({
				try: async () =>
					orderRevisionChain(
						await Promise.all(
							(await listRevisionFiles(campaignId, documentId)).map(readJson<VaultRevision>)
						)
					),
				catch: (cause) => failure('revisionStorage', 'listDocumentRevisions', cause)
			}),
		listCampaignRevisions: (campaignId) =>
			tryPromise({
				try: async () =>
					Promise.all((await listRevisionFiles(campaignId)).map(readJson<VaultRevision>)),
				catch: (cause) => failure('revisionStorage', 'listCampaignRevisions', cause)
			})
	}
}
