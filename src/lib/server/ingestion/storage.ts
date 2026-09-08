import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../failure'
import type { SessionIngestionDraft } from './types'

export type IngestionStorage = {
	write: (
		draft: SessionIngestionDraft,
		transcript: string
	) => Effect<void, Failure<'ingestionStorage', 'write'>>
	read: (
		campaignId: string,
		ingestionId: string
	) => Effect<SessionIngestionDraft, Failure<'ingestionStorage', 'read'>>
}

const ingestionRoot = (rootPath: string, campaignId: string, ingestionId: string) =>
	resolve(rootPath, campaignId, '.loremaster', 'ingestions', ingestionId)

export const filesystemIngestionStorage = (rootPath: string): IngestionStorage => ({
	write: (draft, transcript) =>
		tryPromise({
			try: async () => {
				const root = ingestionRoot(rootPath, draft.campaignId, draft.ingestionId)
				await mkdir(root, { recursive: true })
				await Promise.all([
					writeFile(resolve(root, 'analysis.json'), JSON.stringify(draft, null, 2), {
						encoding: 'utf8',
						flag: 'wx'
					}),
					writeFile(resolve(root, 'transcript.txt'), transcript, { encoding: 'utf8', flag: 'wx' })
				])
			},
			catch: (cause) => failure('ingestionStorage', 'write', cause)
		}),
	read: (campaignId, ingestionId) =>
		tryPromise({
			try: async () =>
				JSON.parse(
					await readFile(
						resolve(ingestionRoot(rootPath, campaignId, ingestionId), 'analysis.json'),
						'utf8'
					)
				) as SessionIngestionDraft,
			catch: (cause) => failure('ingestionStorage', 'read', cause)
		})
})
