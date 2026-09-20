import { resolve } from 'node:path'
import { filesystemRevisionStorage } from '../vault/revisions/storage.js'
import { filesystemVaultStorage } from '../vault/storage/filesystem.js'
import type { StorageAdapter } from './adapter.js'

export const filesystemStorageAdapter = (rootPath: string): StorageAdapter => {
	const root = resolve(rootPath)
	return {
		vault: filesystemVaultStorage(root),
		revisions: filesystemRevisionStorage(root)
	}
}
