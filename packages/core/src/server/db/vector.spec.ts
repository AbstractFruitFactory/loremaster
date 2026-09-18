import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	disconnect: vi.fn<() => Promise<void>>(),
	construct: vi.fn()
}))

vi.mock('@mastra/pg', () => ({
	PgVector: class {
		constructor(options: unknown) {
			mocks.construct(options)
		}

		disconnect() {
			return mocks.disconnect()
		}
	}
}))

import { closeVectorStore, initializeVectorStore } from './vector.js'

describe('vector store lifecycle', () => {
	beforeEach(async () => {
		mocks.disconnect.mockResolvedValue()
		await closeVectorStore()
		vi.clearAllMocks()
	})

	it('disconnects the active store and permits reinitialization', async () => {
		const first = initializeVectorStore('postgres://first')
		expect(initializeVectorStore('postgres://first')).toBe(first)

		await closeVectorStore()
		initializeVectorStore('postgres://second')

		expect(mocks.disconnect).toHaveBeenCalledTimes(1)
		expect(mocks.construct).toHaveBeenCalledTimes(2)
	})

	it('resets state when disconnect fails', async () => {
		initializeVectorStore('postgres://first')
		mocks.disconnect.mockRejectedValueOnce(new Error('disconnect failed'))

		await expect(closeVectorStore()).rejects.toThrow('disconnect failed')
		expect(() => initializeVectorStore('postgres://second')).not.toThrow()
	})
})
