import { describe, expect, it, vi } from 'vitest'
import { createWorkflowRetryAction } from './workflow-retry.js'

describe('workflow retry action', () => {
	it('sets waiting and refreshes after a successful retry', async () => {
		const invoke = vi.fn().mockResolvedValue(undefined)
		const onWaiting = vi.fn()
		const refresh = vi.fn().mockResolvedValue(undefined)
		const setError = vi.fn()
		const retry = createWorkflowRetryAction({
			canRetry: () => true,
			invoke,
			onWaiting,
			refresh,
			setError,
			failureMessage: 'failed'
		})

		await retry()

		expect(invoke).toHaveBeenCalledOnce()
		expect(onWaiting).toHaveBeenCalledWith(true)
		expect(refresh).toHaveBeenCalledOnce()
		expect(setError).toHaveBeenCalledWith('')
	})

	it('clears waiting and records the failure message', async () => {
		const onWaiting = vi.fn()
		const setError = vi.fn()
		const retry = createWorkflowRetryAction({
			canRetry: () => true,
			invoke: vi.fn().mockRejectedValue(new Error('unavailable')),
			onWaiting,
			refresh: vi.fn(),
			setError,
			failureMessage: 'The import analysis could not be restarted. Try again.'
		})

		await retry()

		expect(onWaiting).toHaveBeenCalledWith(false)
		expect(setError).toHaveBeenCalledWith('The import analysis could not be restarted. Try again.')
	})

	it('ignores a second call while the first retry is pending', async () => {
		let resolveInvoke!: () => void
		const invoke = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveInvoke = resolve
				})
		)
		const retry = createWorkflowRetryAction({
			canRetry: () => true,
			invoke,
			onWaiting: vi.fn(),
			refresh: vi.fn().mockResolvedValue(undefined),
			setError: vi.fn(),
			failureMessage: 'failed'
		})

		const first = retry()
		const second = retry()
		resolveInvoke()
		await Promise.all([first, second])

		expect(invoke).toHaveBeenCalledOnce()
	})
})
