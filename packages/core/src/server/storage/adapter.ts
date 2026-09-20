import type { RevisionStorage } from '../vault/revisions/storage.js'
import type { VaultStorage } from '../vault/storage/storage.js'

export type StorageAdapter = {
	vault: VaultStorage
	revisions: RevisionStorage
}
