import type { TranscriptChunk } from './types'

export const DEFAULT_TRANSCRIPT_CHUNK_SIZE = 6_000
export const DEFAULT_TRANSCRIPT_OVERLAP_LINES = 2

type TranscriptLine = {
	content: string
	start: number
	end: number
	line: number
}

const transcriptLines = (transcript: string): TranscriptLine[] => {
	const lines: TranscriptLine[] = []
	let start = 0
	let line = 1

	for (const match of transcript.matchAll(/.*(?:\n|$)/g)) {
		if (!match[0]) continue
		const end = start + match[0].length
		lines.push({ content: match[0], start, end, line })
		start = end
		line++
	}

	return lines
}

export const chunkTranscript = (
	transcript: string,
	options: { maxSize?: number; overlapLines?: number } = {}
): TranscriptChunk[] => {
	const maxSize = options.maxSize ?? DEFAULT_TRANSCRIPT_CHUNK_SIZE
	const overlapLines = options.overlapLines ?? DEFAULT_TRANSCRIPT_OVERLAP_LINES
	const lines = transcriptLines(transcript)
	const chunks: TranscriptChunk[] = []
	let firstLine = 0

	while (firstLine < lines.length) {
		let lastLine = firstLine
		while (
			lastLine + 1 < lines.length &&
			lines[lastLine + 1].end - lines[firstLine].start <= maxSize
		) {
			lastLine++
		}

		const first = lines[firstLine]
		const last = lines[lastLine]
		chunks.push({
			chunkId: `chunk-${chunks.length + 1}`,
			content: transcript.slice(first.start, last.end),
			startStringIndex: first.start,
			endStringIndex: last.end,
			startLine: first.line,
			endLine: last.line
		})

		if (lastLine === lines.length - 1) break
		firstLine = Math.max(firstLine + 1, lastLine - overlapLines + 1)
	}

	return chunks
}
