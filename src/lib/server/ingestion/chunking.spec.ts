import { describe, expect, it } from 'vitest'
import { chunkTranscript } from './chunking'
import { locateEvidence } from './evidence'

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

	it('accepts one exact quotation and rejects absent or repeated evidence', () => {
		const transcript = 'GM: The bell rings.\nPlayer: I listen.\nGM: The bell rings.'
		const [chunk] = chunkTranscript(transcript)
		const evidence = locateEvidence(transcript, chunk, 'Player: I listen.')

		expect(evidence).toMatchObject({ startLine: 2, endLine: 2 })
		expect(transcript.slice(evidence!.startStringIndex, evidence!.endStringIndex)).toBe(
			'Player: I listen.'
		)
		expect(locateEvidence(transcript, chunk, 'GM: The bell rings.')).toBeUndefined()
		expect(locateEvidence(transcript, chunk, 'invented')).toBeUndefined()
	})
})
