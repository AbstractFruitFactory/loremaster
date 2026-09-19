import { describe, expect, it } from 'vitest'
import { withCampaignImportOrchestrationLock } from './serialization'

describe('campaign import orchestration serialization', () => {
	it('makes a retry observe the cleanup fence set by an in-flight finish', async () => {
		let cleanupStarted = false
		let releaseFinish!: () => void
		const finishGate = new Promise<void>((resolve) => {
			releaseFinish = resolve
		})
		let finishHasFence!: () => void
		const fenceSet = new Promise<void>((resolve) => {
			finishHasFence = resolve
		})

		const finish = withCampaignImportOrchestrationLock('campaign', 'import', async () => {
			cleanupStarted = true
			finishHasFence()
			await finishGate
		})
		await fenceSet

		const retry = withCampaignImportOrchestrationLock('campaign', 'import', async () => {
			if (cleanupStarted) throw new Error('cleanup-started')
		})
		releaseFinish()

		await finish
		await expect(retry).rejects.toThrow('cleanup-started')
	})
})
