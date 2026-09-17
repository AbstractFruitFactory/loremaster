import { createHash } from 'node:crypto'
import { MDocument } from '@mastra/rag'
import { tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../../failure'
import type { VaultDocument } from '../../vault/types'
import type { ContextSource } from '../types'

export const DEFAULT_CHUNK_SIZE = 4_000
export const DEFAULT_CHUNK_OVERLAP = 50

type DocumentHeading = {
	index: number
	level: number
	title: string
}

const documentHeadings = (content: string): DocumentHeading[] =>
	[...content.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((match) => ({
		index: match.index,
		level: match[1]?.length ?? 1,
		title: match[2]?.trim() ?? ''
	}))

const headingAt = (headings: DocumentHeading[], startIndex: number) =>
	headings.findLast(({ index, level }) => level > 1 && index <= startIndex)?.title

const fragmentId = (documentId: string, hash: string, occurrence: number) =>
	`${documentId}:${hash}:${occurrence}`

export const mastraMarkdownChunker =
	({
		maxSize = DEFAULT_CHUNK_SIZE,
		overlap = DEFAULT_CHUNK_OVERLAP
	}: {
		maxSize?: number
		overlap?: number
	} = {}): ((campaignId: string, document: VaultDocument) => Effect<ContextSource[], Failure>) =>
	(campaignId, document) =>
		tryPromise({
			try: async () => {
				const headings = documentHeadings(document.content)
				const chunks = await MDocument.fromMarkdown(document.content).chunk({
					strategy: 'markdown',
					maxSize,
					overlap,
					addStartIndex: true
				})
				const hashOccurrences = new Map<string, number>()

				return chunks.flatMap((chunk, position): ContextSource[] => {
					const content = chunk.text.trim()

					if (!content) return []

					const hash = createHash('sha256').update(content).digest('hex')
					const occurrence = hashOccurrences.get(hash) ?? 0
					const startIndex =
						typeof chunk.metadata.startIndex === 'number' ? chunk.metadata.startIndex : 0
					hashOccurrences.set(hash, occurrence + 1)

					return [
						{
							fragment: {
								id: fragmentId(document.id, hash, occurrence),
								campaignId,
								documentId: document.id,
								title: document.title,
								documentType: document.type,
								heading: headingAt(headings, startIndex),
								content,
								position,
								contentHash: hash
							},
							aliases: document.aliases
						}
					]
				})
			},
			catch: (cause) => failure('context', 'chunkDocument', cause)
		})
