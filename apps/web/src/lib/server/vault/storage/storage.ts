import type { Effect } from 'effect/Effect'
import type { Failure } from '../../failure'

export type VaultStorage = {
	read: (
		campaignId: string,
		path: string
	) => Effect<string, Failure<'vaultStorage', 'readDocument'>>
	write: (
		campaignId: string,
		path: string,
		content: string
	) => Effect<void, Failure<'vaultStorage', 'writeDocument'>>
	create: (
		campaignId: string,
		path: string,
		content: string
	) => Effect<void, Failure<'vaultStorage', 'createDocument'>>
	delete: (
		campaignId: string,
		path: string
	) => Effect<void, Failure<'vaultStorage', 'deleteDocument'>>
	list: (campaignId: string) => Effect<string[], Failure<'vaultStorage', 'listDocuments'>>
}
