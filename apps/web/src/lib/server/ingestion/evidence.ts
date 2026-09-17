import type { Evidence, EvidenceRange, TranscriptChunk } from './types'

type TranscriptLine = {
	start: number
	end: number
}

export const MAX_EVIDENCE_RANGES = 8

export type EvidenceMaterializationFailure =
	| 'missing-evidence-ranges'
	| 'too-many-evidence-ranges'
	| 'invalid-evidence-range'
	| 'evidence-outside-chunk'

export type EvidenceMaterialization =
	{ ok: true; evidence: Evidence[] } | { ok: false; reason: EvidenceMaterializationFailure }

const transcriptLines = (transcript: string): TranscriptLine[] => {
	const lines: TranscriptLine[] = []
	for (const match of transcript.matchAll(/.*(?:\r\n|\n|$)/g)) {
		const raw = match[0]
		if (!raw) continue
		const start = match.index
		const lineBreakLength = raw.endsWith('\r\n') ? 2 : raw.endsWith('\n') ? 1 : 0
		lines.push({ start, end: start + raw.length - lineBreakLength })
	}
	return lines
}

const uniqueRanges = (ranges: EvidenceRange[]) => [
	...new Map(ranges.map((range) => [`${range.startLine}:${range.endLine}`, range])).values()
]

export const materializeEvidenceRanges = (
	transcript: string,
	chunk: TranscriptChunk,
	ranges: EvidenceRange[]
): EvidenceMaterialization => {
	if (!ranges.length) return { ok: false, reason: 'missing-evidence-ranges' }
	if (ranges.length > MAX_EVIDENCE_RANGES) {
		return { ok: false, reason: 'too-many-evidence-ranges' }
	}

	const lines = transcriptLines(transcript)
	const evidence: Evidence[] = []

	for (const range of uniqueRanges(ranges)) {
		if (
			!Number.isInteger(range.startLine) ||
			!Number.isInteger(range.endLine) ||
			range.startLine < 1 ||
			range.endLine < range.startLine
		) {
			return { ok: false, reason: 'invalid-evidence-range' }
		}

		if (range.startLine < chunk.startLine || range.endLine > chunk.endLine) {
			return { ok: false, reason: 'evidence-outside-chunk' }
		}

		const first = lines[range.startLine - 1]
		const last = lines[range.endLine - 1]
		if (!first || !last) return { ok: false, reason: 'invalid-evidence-range' }

		evidence.push({
			excerpt: transcript.slice(first.start, last.end),
			chunkId: chunk.chunkId,
			startStringIndex: first.start,
			endStringIndex: last.end,
			startLine: range.startLine,
			endLine: range.endLine
		})
	}

	return { ok: true, evidence }
}
