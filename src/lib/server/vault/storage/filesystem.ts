import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { tryPromise } from 'effect/Effect'
import { failure } from '../../failure'
import type { VaultStorage } from './storage'

const assertNoSymlinks = async (base: string, target: string) => {
	let current = base
	const segments = relative(base, target).split(sep).filter(Boolean)

	for (const segment of ['', ...segments]) {
		if (segment) current = resolve(current, segment)

		try {
			const stats = await lstat(current)
			if (stats.isSymbolicLink()) throw Error('Symbolic links are not allowed in campaign vaults')
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
			throw error
		}
	}
}

const resolveCampaignRoot = (root: string, campaignId: string) => {
	if (!campaignId || campaignId === '.' || campaignId === '..' || /[/\\]/.test(campaignId)) {
		throw Error('Invalid campaign ID')
	}

	const campaignRoot = resolve(root, campaignId)
	const relativePath = relative(root, campaignRoot)

	if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
		throw Error('Campaign path escapes the vault root')
	}

	return campaignRoot
}

const resolveDocumentPath = (root: string, campaignId: string, path: string) => {
	const campaignRoot = resolveCampaignRoot(root, campaignId)
	const documentPath = resolve(campaignRoot, path)
	const relativePath = relative(campaignRoot, documentPath)

	if (
		!path ||
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		relativePath.startsWith(sep)
	) {
		throw Error('Document path escapes the campaign vault')
	}

	return documentPath
}

const listMarkdownFiles = async (
	campaignRoot: string,
	directory = campaignRoot
): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true })
	const paths = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = resolve(directory, entry.name)

			if (entry.isSymbolicLink()) {
				throw Error('Symbolic links are not allowed in campaign vaults')
			}

			if (entry.isDirectory()) {
				if (entry.name === '.loremaster') return []
				return listMarkdownFiles(campaignRoot, entryPath)
			}

			return entry.isFile() && entry.name.toLowerCase().endsWith('.md')
				? [relative(campaignRoot, entryPath).split(sep).join('/')]
				: []
		})
	)

	return paths.flat()
}

export const filesystemVaultStorage = (rootPath: string): VaultStorage => {
	const root = resolve(rootPath)

	const read: VaultStorage['read'] = (campaignId, path) =>
		tryPromise({
			try: async () => {
				const documentPath = resolveDocumentPath(root, campaignId, path)
				await assertNoSymlinks(root, documentPath)
				return readFile(documentPath, 'utf8')
			},
			catch: (cause) => failure('vaultStorage', 'readDocument', cause)
		})

	const write: VaultStorage['write'] = (campaignId, path, content) =>
		tryPromise({
			try: async () => {
				const documentPath = resolveDocumentPath(root, campaignId, path)
				await assertNoSymlinks(root, documentPath)
				await mkdir(dirname(documentPath), { recursive: true })
				const temporaryPath = resolve(
					dirname(documentPath),
					`.${randomUUID()}.${documentPath.split(sep).at(-1)}.tmp`
				)
				try {
					await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
					await rename(temporaryPath, documentPath)
				} finally {
					await rm(temporaryPath, { force: true })
				}
			},
			catch: (cause) => failure('vaultStorage', 'writeDocument', cause)
		})

	const create: VaultStorage['create'] = (campaignId, path, content) =>
		tryPromise({
			try: async () => {
				const documentPath = resolveDocumentPath(root, campaignId, path)
				await assertNoSymlinks(root, documentPath)
				await mkdir(dirname(documentPath), { recursive: true })
				await writeFile(documentPath, content, { encoding: 'utf8', flag: 'wx' })
			},
			catch: (cause) => failure('vaultStorage', 'createDocument', cause)
		})

	const deleteDocument: VaultStorage['delete'] = (campaignId, path) =>
		tryPromise({
			try: async () => {
				const documentPath = resolveDocumentPath(root, campaignId, path)
				await assertNoSymlinks(root, documentPath)
				await unlink(documentPath)
			},
			catch: (cause) => failure('vaultStorage', 'deleteDocument', cause)
		})

	const list: VaultStorage['list'] = (campaignId) =>
		tryPromise({
			try: async () => {
				const campaignRoot = resolveCampaignRoot(root, campaignId)
				await assertNoSymlinks(root, campaignRoot)

				try {
					return (await listMarkdownFiles(campaignRoot)).sort()
				} catch (cause) {
					if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
					throw cause
				}
			},
			catch: (cause) => failure('vaultStorage', 'listDocuments', cause)
		})

	return {
		create,
		read,
		write,
		delete: deleteDocument,
		list
	}
}
