import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './bounded-map'

describe('mapWithConcurrency', () => {
	it('bounds active work and preserves input order', async () => {
		let active = 0
		let maximumActive = 0
		const result = await mapWithConcurrency([30, 5, 20, 1], 2, async (delay, index) => {
			active += 1
			maximumActive = Math.max(maximumActive, active)
			await new Promise((resolve) => setTimeout(resolve, delay))
			active -= 1
			return `result-${index}`
		})

		expect(maximumActive).toBe(2)
		expect(result).toEqual(['result-0', 'result-1', 'result-2', 'result-3'])
	})

	it('rejects invalid concurrency', async () => {
		await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(RangeError)
	})
})
