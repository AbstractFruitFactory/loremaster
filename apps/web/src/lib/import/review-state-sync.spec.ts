import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createCampaignImportReviewStateSync,
	type CampaignImportReviewSnapshot,
	type CampaignImportReviewSyncStatus
} from './review-state-sync.js'

const snapshot = (
	selectedProposalIds: string[],
	resolutions: CampaignImportReviewSnapshot['resolutions'] = []
): CampaignImportReviewSnapshot => ({ selectedProposalIds, resolutions })

afterEach(() => {
	vi.useRealTimers()
})

describe('campaign import review state sync', () => {
	it('debounces a save with the last acknowledged revision', async () => {
		vi.useFakeTimers()
		const statuses: CampaignImportReviewSyncStatus[] = []
		const save = vi.fn().mockResolvedValue({ revision: 5 })
		const sync = createCampaignImportReviewStateSync({
			initialRevision: 4,
			save,
			onStatus: (status) => statuses.push(status)
		})

		sync.schedule(snapshot(['first']))
		sync.schedule(snapshot(['second']))
		await vi.advanceTimersByTimeAsync(499)
		expect(save).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)

		expect(save).toHaveBeenCalledOnce()
		expect(save).toHaveBeenCalledWith({
			expectedRevision: 4,
			selectedProposalIds: ['second'],
			resolutions: []
		})
		expect(statuses.at(-1)).toEqual({ phase: 'saved', revision: 5 })
	})

	it('serializes changes made while a save is active', async () => {
		let resolveFirst: ((value: { revision: number }) => void) | undefined
		const firstSave = new Promise<{ revision: number }>((resolve) => {
			resolveFirst = resolve
		})
		const save = vi
			.fn()
			.mockImplementationOnce(() => firstSave)
			.mockResolvedValueOnce({ revision: 3 })
		const sync = createCampaignImportReviewStateSync({
			initialRevision: 1,
			save,
			onStatus: () => undefined
		})

		sync.schedule(snapshot(['first']))
		const flushing = sync.flush()
		await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
		sync.schedule(snapshot(['second']))
		resolveFirst?.({ revision: 2 })
		await flushing

		expect(save).toHaveBeenCalledTimes(2)
		expect(save.mock.calls[1]?.[0]).toEqual({
			expectedRevision: 2,
			selectedProposalIds: ['second'],
			resolutions: []
		})
		expect(sync.getAcknowledgedRevision()).toBe(3)
		expect(sync.hasPendingChanges()).toBe(false)
	})

	it('reports revision conflicts and refuses a commit flush', async () => {
		const statuses: CampaignImportReviewSyncStatus[] = []
		const sync = createCampaignImportReviewStateSync({
			initialRevision: 7,
			save: async () => {
				throw { status: 409 }
			},
			onStatus: (status) => statuses.push(status)
		})

		sync.schedule(snapshot(['proposal']))

		await expect(sync.flush()).resolves.toBe(false)
		expect(statuses.at(-1)).toEqual({ phase: 'conflict', revision: 7 })
		expect(sync.hasPendingChanges()).toBe(true)
	})

	it('flushes the latest pending snapshot when disposed before the debounce', async () => {
		vi.useFakeTimers()
		const statuses: CampaignImportReviewSyncStatus[] = []
		const save = vi.fn().mockResolvedValue({ revision: 2 })
		const sync = createCampaignImportReviewStateSync({
			initialRevision: 1,
			save,
			onStatus: (status) => statuses.push(status)
		})

		sync.schedule(snapshot(['latest']))
		sync.dispose()
		await Promise.resolve()
		await Promise.resolve()

		expect(save).toHaveBeenCalledOnce()
		expect(save).toHaveBeenCalledWith({
			expectedRevision: 1,
			selectedProposalIds: ['latest'],
			resolutions: []
		})
		expect(statuses.at(-1)).toEqual({ phase: 'saved', revision: 2 })
	})

	it('does not save or emit status when disposed without pending changes', () => {
		const statuses: CampaignImportReviewSyncStatus[] = []
		const save = vi.fn()
		const sync = createCampaignImportReviewStateSync({
			initialRevision: 1,
			save,
			onStatus: (status) => statuses.push(status)
		})

		sync.dispose()

		expect(save).not.toHaveBeenCalled()
		expect(statuses).toEqual([])
	})
})
