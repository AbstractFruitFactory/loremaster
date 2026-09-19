import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCampaignImportLifecyclePoller } from './lifecycle-polling.js'

afterEach(() => {
	vi.useRealTimers()
})

describe('campaign import lifecycle poller', () => {
	it('polls while lifecycle work remains and stops at a terminal state', async () => {
		vi.useFakeTimers()
		let active = true
		const refresh = vi.fn(async () => {
			active = false
		})
		const afterRefresh = vi.fn()
		const poller = createCampaignImportLifecyclePoller({
			refresh,
			shouldContinue: () => active,
			afterRefresh,
			initialDelay: 500
		})

		poller.start()
		await vi.advanceTimersByTimeAsync(500)
		await vi.runAllTicks()

		expect(refresh).toHaveBeenCalledOnce()
		expect(afterRefresh).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(5_000)
		expect(refresh).toHaveBeenCalledOnce()
	})

	it('serializes immediate refresh requests', async () => {
		let resolveRefresh: (() => void) | undefined
		const refresh = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveRefresh = resolve
				})
		)
		const poller = createCampaignImportLifecyclePoller({
			refresh,
			shouldContinue: () => false
		})

		const first = poller.refreshNow()
		const second = poller.refreshNow()
		expect(refresh).toHaveBeenCalledOnce()
		resolveRefresh?.()
		await Promise.all([first, second])
		expect(refresh).toHaveBeenCalledOnce()
	})
})
