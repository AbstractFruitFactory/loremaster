import type { Evidence, TranscriptChunk } from './types'

const lineAt = (source: string, index: number) =>
	1 + (source.slice(0, index).match(/\n/g)?.length ?? 0)

export const locateEvidence = (
	transcript: string,
	chunk: TranscriptChunk,
	excerpt: string
): Evidence | undefined => {
	if (!excerpt) return undefined
	const localStart = chunk.content.indexOf(excerpt)
	if (localStart < 0 || localStart !== chunk.content.lastIndexOf(excerpt)) return undefined

	const startStringIndex = chunk.startStringIndex + localStart
	const endStringIndex = startStringIndex + excerpt.length
	if (transcript.slice(startStringIndex, endStringIndex) !== excerpt) return undefined

	return {
		excerpt,
		chunkId: chunk.chunkId,
		startStringIndex,
		endStringIndex,
		startLine: lineAt(transcript, startStringIndex),
		endLine: lineAt(transcript, Math.max(startStringIndex, endStringIndex - 1))
	}
}
