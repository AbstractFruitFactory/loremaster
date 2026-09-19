import { fail, succeed } from 'effect/Effect'
import { CampaignImportNotFoundError } from '@loremaster/core/server/ingestion/storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const campaign = vi.hoisted(() => ({
	getCampaign: vi.fn()
}))

const campaignImport = vi.hoisted(() => ({
	commitOperations: {
		acquireOperationLease: vi.fn(),
		releaseOperationLease: vi.fn(),
		getLifecycleState: vi.fn(),
		discard: vi.fn(),
		recordChronologyDispatch: vi.fn(),
		isCleanupStarted: vi.fn()
	}
}))

const dbos = vi.hoisted(() => ({
	cancelAnalysis: vi.fn(),
	retryCampaignImport: vi.fn()
}))

vi.mock('#lib/server/app.js', () => ({ campaign, campaignImport }))
vi.mock('#lib/server/dbos/client.js', () => ({
	CampaignImportWorkflowRetryError: class CampaignImportWorkflowRetryError extends Error {
		constructor(
			readonly kind: string,
			readonly lifecycle: string
		) {
			super(`The ${kind} workflow cannot be retried after it is ${lifecycle}`)
		}
	},
	getIngestionDbosAdapter: async () => dbos
}))
vi.mock('#lib/server/failure.js', () => ({
	logFailure: vi.fn()
}))

import { isHttpError } from '@sveltejs/kit'
import { campaignImportNotFoundHttpError } from './http.js'
import {
	discardCampaignImportOperation,
	retryCampaignImportWorkflowOperation
} from './mutations.js'
import { readCampaignImportLifecycleState } from './queries.js'

const campaignId = '40000000-0000-5000-8000-000000000001'
const ingestionId = '30000000-0000-5000-8000-000000000001'

const httpError = async (operation: () => Promise<unknown>) => {
	try {
		await operation()
		throw new Error('expected an HTTP error')
	} catch (cause) {
		if (isHttpError(cause)) return cause
		if (cause && typeof cause === 'object' && 'status' in cause) {
			return cause as { status: number; body?: { message?: string } }
		}
		const message = cause instanceof Error ? cause.message : undefined
		if (message) {
			try {
				const parsed = JSON.parse(message) as { status?: number; message?: string }
				if (typeof parsed.status === 'number') {
					return { status: parsed.status, body: { message: parsed.message } }
				}
			} catch {
				/* continue */
			}
		}
		throw cause
	}
}

describe('campaign import orchestration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		campaign.getCampaign.mockReturnValue(succeed({ id: campaignId }))
		campaignImport.commitOperations.acquireOperationLease.mockReturnValue(
			succeed({ ownerToken: 'owner' })
		)
		campaignImport.commitOperations.releaseOperationLease.mockReturnValue(succeed(undefined))
		campaignImport.commitOperations.discard.mockReturnValue(succeed(undefined))
		campaignImport.commitOperations.recordChronologyDispatch.mockReturnValue(succeed(undefined))
		campaignImport.commitOperations.isCleanupStarted.mockReturnValue(succeed(false))
		dbos.cancelAnalysis.mockResolvedValue(undefined)
		dbos.retryCampaignImport.mockResolvedValue('workflow-1')
	})

	it('holds the mutation lease for the entire discard flow', async () => {
		const { tryPromise } = await import('effect/Effect')
		const order: string[] = []
		let releaseFirst!: () => void
		const firstHeld = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		let firstReachedState = false
		let resolveReached!: () => void
		const reachedState = new Promise<void>((resolve) => {
			resolveReached = resolve
		})
		campaignImport.commitOperations.acquireOperationLease.mockImplementation(() => {
			order.push('acquire')
			return succeed({ ownerToken: 'owner' })
		})
		campaignImport.commitOperations.releaseOperationLease.mockImplementation(() => {
			order.push('release')
			return succeed(undefined)
		})
		campaignImport.commitOperations.getLifecycleState.mockImplementation(() => {
			order.push('read-state')
			if (!firstReachedState) {
				firstReachedState = true
				resolveReached()
				return tryPromise(async () => {
					await firstHeld
					return { commitRequested: false }
				})
			}
			return succeed({ commitRequested: false })
		})
		dbos.cancelAnalysis.mockImplementation(async () => {
			order.push('cancel')
		})
		campaignImport.commitOperations.discard.mockImplementation(() => {
			order.push('discard')
			return succeed(undefined)
		})

		const first = discardCampaignImportOperation(campaignId, ingestionId)
		await reachedState
		const second = discardCampaignImportOperation(campaignId, ingestionId)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(order).toEqual(['acquire', 'read-state'])
		releaseFirst()
		await first
		await second
		expect(order).toEqual([
			'acquire',
			'read-state',
			'cancel',
			'discard',
			'release',
			'acquire',
			'read-state',
			'cancel',
			'discard',
			'release'
		])
	})

	it('does not treat chronology dispatch bookkeeping failures as enqueue failures', async () => {
		campaignImport.commitOperations.getLifecycleState.mockReturnValue(
			succeed({ completion: { kind: 'campaign-import-completion' } })
		)
		dbos.retryCampaignImport.mockResolvedValue('workflow-1')
		campaignImport.commitOperations.recordChronologyDispatch.mockReturnValue(
			fail({
				domain: 'ingestionStorage',
				operation: 'writeCampaignImportChronologyDispatch',
				cause: new Error('disk full')
			})
		)

		const error = await httpError(() =>
			retryCampaignImportWorkflowOperation('chronology-analysis', campaignId, ingestionId)
		)

		expect(error.status).toBe(500)
		expect(error.body?.message).toBe('Unable to record chronology dispatch')
		expect(dbos.retryCampaignImport).toHaveBeenCalledOnce()
	})

	it('maps only typed not-found errors to 404 and other storage failures to 500', async () => {
		expect(
			campaignImportNotFoundHttpError(
				{
					domain: 'ingestionStorage',
					operation: 'readCampaignImportLifecycleState',
					cause: new CampaignImportNotFoundError()
				},
				'Campaign import was not found'
			)
		).toEqual({
			status: 404,
			message: 'Campaign import was not found'
		})

		campaignImport.commitOperations.getLifecycleState.mockReturnValue(
			fail({
				domain: 'ingestionStorage',
				operation: 'readCampaignImportLifecycleState',
				cause: new CampaignImportNotFoundError()
			})
		)
		expect(
			await httpError(() => readCampaignImportLifecycleState(campaignId, ingestionId))
		).toMatchObject({
			status: 404,
			body: { message: 'Campaign import was not found' }
		})

		campaignImport.commitOperations.getLifecycleState.mockReturnValue(
			fail({
				domain: 'ingestionStorage',
				operation: 'readCampaignImportLifecycleState',
				cause: new Error('permission denied')
			})
		)
		expect(
			await httpError(() => readCampaignImportLifecycleState(campaignId, ingestionId))
		).toMatchObject({
			status: 500,
			body: { message: 'Unable to read campaign import state' }
		})
	})
})
