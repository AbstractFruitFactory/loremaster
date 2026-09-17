import { describe, expect, it } from 'vitest'
import { chunkTranscript } from './chunking'
import { materializeEvidenceRanges } from './evidence'

describe('session transcript chunking and evidence', () => {
	it('chunks on line boundaries with overlap and stable global positions', () => {
		const transcript = 'GM: One\nPlayer: Two 🐉\nGM: Three\nPlayer: Four'
		const chunks = chunkTranscript(transcript, { maxSize: 24, overlapLines: 1 })

		expect(chunks.length).toBeGreaterThan(1)
		expect(chunks[0]).toMatchObject({ startStringIndex: 0, startLine: 1 })
		expect(chunks[1].startLine).toBe(chunks[0].endLine)
		expect(transcript.slice(chunks[1].startStringIndex, chunks[1].endStringIndex)).toBe(
			chunks[1].content
		)
	})

	it('materializes exact source text from line ranges even when text repeats', () => {
		const transcript = 'DM: Four.\nPlayer: What?\nDM: Four.'
		const [chunk] = chunkTranscript(transcript)
		const result = materializeEvidenceRanges(transcript, chunk, [{ startLine: 3, endLine: 3 }])

		expect(result).toEqual({
			ok: true,
			evidence: [expect.objectContaining({ excerpt: 'DM: Four.', startLine: 3, endLine: 3 })]
		})
	})

	it('supports multiple evidence spans and rejects ranges outside the extraction window', () => {
		const transcript =
			'GM: Seraphine Vey.\nPlayer: Elias daughter?\nGM: Yes.\nGM: She died 29 years ago.'
		const [chunk] = chunkTranscript(transcript)
		const result = materializeEvidenceRanges(transcript, chunk, [
			{ startLine: 1, endLine: 1 },
			{ startLine: 2, endLine: 4 }
		])

		expect(result).toMatchObject({
			ok: true,
			evidence: [
				{ excerpt: 'GM: Seraphine Vey.', startLine: 1, endLine: 1 },
				{
					excerpt: 'Player: Elias daughter?\nGM: Yes.\nGM: She died 29 years ago.',
					startLine: 2,
					endLine: 4
				}
			]
		})
		expect(materializeEvidenceRanges(transcript, chunk, [{ startLine: 0, endLine: 1 }])).toEqual({
			ok: false,
			reason: 'invalid-evidence-range'
		})
		expect(
			materializeEvidenceRanges(
				transcript,
				chunk,
				Array.from({ length: 9 }, () => ({ startLine: 1, endLine: 1 }))
			)
		).toEqual({ ok: false, reason: 'too-many-evidence-ranges' })
	})
})
