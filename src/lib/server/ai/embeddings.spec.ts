import { runSync } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIMENSIONS, embedTexts } from './embeddings'

describe('mock embeddings', () => {
	it('returns deterministic normalized vectors with fixed dimensions', () => {
		const [first, second] = runSync(
			embedTexts({ values: ['Varek protects Westgate', 'Varek protects Westgate'] })
		)

		expect(first).toEqual(second)
		expect(first).toHaveLength(EMBEDDING_DIMENSIONS)
		expect(Math.hypot(...first)).toBeCloseTo(1)
	})

	it('preserves input order for batched values', () => {
		const batch = runSync(embedTexts({ values: ['Varek', 'Mara'] }))
		const varek = runSync(embedTexts({ values: ['Varek'] }))
		const mara = runSync(embedTexts({ values: ['Mara'] }))

		expect(batch).toEqual([...varek, ...mara])
	})

	it('returns a zero vector for text without searchable tokens', () => {
		const [embedding] = runSync(embedTexts({ values: ['   '] }))

		expect(embedding).toEqual(Array<number>(EMBEDDING_DIMENSIONS).fill(0))
	})
})
