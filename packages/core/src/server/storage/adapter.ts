import type { RevisionStorage } from '../vault/revisions/storage.js'
import type { VaultStorage } from '../vault/storage/storage.js'
import type { CampaignImportStorage, IngestionStorage } from '../ingestion/storage.js'

export type ObjectStorage = {
	read(path: string): Promise<string>
	create(path: string, content: string): Promise<void>
	write(path: string, content: string): Promise<void>
	delete(path: string): Promise<void>
	list(path?: string): Promise<string[]>
}

export type StorageAdapter = {
	vault: VaultStorage
	revisions: RevisionStorage
	ingestion: IngestionStorage & CampaignImportStorage
}
