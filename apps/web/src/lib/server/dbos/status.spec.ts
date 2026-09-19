import type { WorkflowStatus } from '@dbos-inc/dbos-sdk'
import {
	ANALYSIS_QUEUE_NAME,
	ANALYSIS_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_ANALYSIS_QUEUE_NAME,
	CAMPAIGN_IMPORT_ANALYSIS_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_QUEUE_NAME,
	CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_QUEUE_NAME,
	CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_COMMIT_QUEUE_NAME,
	CAMPAIGN_IMPORT_COMMIT_WORKFLOW_NAME,
	COMMIT_QUEUE_NAME,
	COMMIT_WORKFLOW_NAME,
	campaignImportAnalysisWorkflowId,
	campaignImportChronologyAnalysisWorkflowId,
	campaignImportChronologyCommitWorkflowId,
	campaignImportCommitWorkflowId,
	type CampaignImportWorkflowProgress
} from '@loremaster/core/workflows/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createIngestionDbosAdapter, type IngestionDbosClient } from './client'
import { isWorkflowRetryable, mapIngestionWorkflowStatus } from './status'

const reference = {
	campaignId: 'campaign-1',
	ingestionId: 'ingestion-1',
	workflowId: 'workflow-1'
}

describe('ingestion DBOS adapter', () => {
	it('uses deterministic workflow and deduplication ids for starts', async () => {
		const enqueuePortable = vi.fn(async (options: { workflowID: string }) => ({
			workflowID: options.workflowID
		}))
		const adapter = createIngestionDbosAdapter({
			enqueuePortable,
			getWorkflow: vi.fn(),
			getEvent: vi.fn(),
			cancelWorkflow: vi.fn(),
			resumeWorkflow: vi.fn()
		} as unknown as IngestionDbosClient)

		await adapter.enqueueAnalysis(reference.workflowId, {
			campaignId: reference.campaignId,
			ingestionId: reference.ingestionId
		})
		await adapter.enqueueAnalysis(reference.workflowId, {
			campaignId: reference.campaignId,
			ingestionId: reference.ingestionId
		})
		await adapter.enqueueCommit(reference.workflowId, {
			campaignId: reference.campaignId,
			ingestionId: reference.ingestionId
		})
		await adapter.enqueueCampaignImport('analysis', reference.campaignId, reference.ingestionId)
		await adapter.enqueueCampaignImport('commit', reference.campaignId, reference.ingestionId)
		await adapter.enqueueCampaignImport(
			'chronology-analysis',
			reference.campaignId,
			reference.ingestionId
		)
		await adapter.enqueueCampaignImport(
			'chronology-commit',
			reference.campaignId,
			reference.ingestionId
		)

		expect(enqueuePortable).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				queueName: ANALYSIS_QUEUE_NAME,
				workflowName: ANALYSIS_WORKFLOW_NAME,
				workflowID: reference.workflowId,
				deduplicationID: reference.workflowId,
				duplicationPolicy: 'return-existing'
			}),
			[expect.objectContaining({ ingestionId: reference.ingestionId })]
		)
		expect(enqueuePortable).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				queueName: COMMIT_QUEUE_NAME,
				workflowName: COMMIT_WORKFLOW_NAME
			}),
			expect.any(Array)
		)
		expect(enqueuePortable).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({
				queueName: CAMPAIGN_IMPORT_ANALYSIS_QUEUE_NAME,
				workflowName: CAMPAIGN_IMPORT_ANALYSIS_WORKFLOW_NAME
			}),
			expect.any(Array)
		)
		expect(enqueuePortable).toHaveBeenNthCalledWith(
			5,
			expect.objectContaining({
				queueName: CAMPAIGN_IMPORT_COMMIT_QUEUE_NAME,
				workflowName: CAMPAIGN_IMPORT_COMMIT_WORKFLOW_NAME
			}),
			expect.any(Array)
		)
		expect(enqueuePortable).toHaveBeenNthCalledWith(
			6,
			expect.objectContaining({
				queueName: CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_QUEUE_NAME,
				workflowName: CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_WORKFLOW_NAME
			}),
			expect.any(Array)
		)
		expect(enqueuePortable).toHaveBeenNthCalledWith(
			7,
			expect.objectContaining({
				queueName: CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_QUEUE_NAME,
				workflowName: CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_WORKFLOW_NAME
			}),
			expect.any(Array)
		)
	})

	it('builds distinct deterministic campaign import workflow ids', () => {
		const args = [reference.campaignId, reference.ingestionId] as const
		const ids = [
			campaignImportAnalysisWorkflowId(...args),
			campaignImportCommitWorkflowId(...args),
			campaignImportChronologyAnalysisWorkflowId(...args),
			campaignImportChronologyCommitWorkflowId(...args)
		]
		expect(new Set(ids).size).toBe(4)
		expect(ids.every((id) => id.includes(reference.campaignId))).toBe(true)
	})

	it('cancels active analyses and leaves terminal analyses unchanged', async () => {
		const cancelWorkflow = vi.fn()
		const getWorkflow = vi
			.fn()
			.mockResolvedValueOnce({ status: 'ENQUEUED' } as WorkflowStatus)
			.mockResolvedValueOnce({ status: 'SUCCESS' } as WorkflowStatus)
		const adapter = createIngestionDbosAdapter({
			enqueuePortable: vi.fn(),
			getWorkflow,
			getEvent: vi.fn(),
			cancelWorkflow,
			resumeWorkflow: vi.fn()
		} as unknown as IngestionDbosClient)

		await adapter.cancelAnalysis(reference.workflowId)
		await adapter.cancelAnalysis(reference.workflowId)

		expect(cancelWorkflow).toHaveBeenCalledOnce()
		expect(cancelWorkflow).toHaveBeenCalledWith(reference.workflowId)
	})

	it('enqueues not-started imports, resumes failed and cancelled imports, and rejects success', async () => {
		const enqueuePortable = vi.fn(async (options: { workflowID: string }) => ({
			workflowID: options.workflowID
		}))
		const resumeWorkflow = vi.fn()
		const getWorkflow = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ status: 'ERROR' } as WorkflowStatus)
			.mockResolvedValueOnce({ status: 'CANCELLED' } as WorkflowStatus)
			.mockResolvedValueOnce({ status: 'ENQUEUED' } as WorkflowStatus)
			.mockResolvedValueOnce({ status: 'SUCCESS' } as WorkflowStatus)
		const adapter = createIngestionDbosAdapter({
			enqueuePortable,
			getWorkflow,
			getEvent: vi.fn(),
			cancelWorkflow: vi.fn(),
			resumeWorkflow
		})

		await adapter.retryCampaignImport('analysis', reference.campaignId, reference.ingestionId)
		await adapter.retryCampaignImport('commit', reference.campaignId, reference.ingestionId)
		await adapter.retryCampaignImport(
			'chronology-analysis',
			reference.campaignId,
			reference.ingestionId
		)
		await expect(
			adapter.retryCampaignImport('chronology-commit', reference.campaignId, reference.ingestionId)
		).rejects.toMatchObject({ lifecycle: 'queued' })
		await expect(
			adapter.retryCampaignImport('analysis', reference.campaignId, reference.ingestionId)
		).rejects.toMatchObject({ lifecycle: 'succeeded' })

		expect(enqueuePortable).toHaveBeenCalledOnce()
		expect(resumeWorkflow).toHaveBeenCalledTimes(2)
	})
})

describe('ingestion workflow status mapping', () => {
	it('uses one retryability policy for workflow lifecycle states', () => {
		expect(
			Object.fromEntries(
				(['not-started', 'queued', 'running', 'succeeded', 'failed', 'cancelled'] as const).map(
					(lifecycle) => [lifecycle, isWorkflowRetryable(lifecycle)]
				)
			)
		).toEqual({
			'not-started': true,
			queued: false,
			running: false,
			succeeded: false,
			failed: true,
			cancelled: true
		})
	})

	it('marks missing workflow rows as retryable and not started', () => {
		expect(
			mapIngestionWorkflowStatus({
				kind: 'commit',
				reference,
				status: undefined,
				progress: null
			})
		).toMatchObject({
			lifecycle: 'not-started',
			error: { code: 'workflow.notFound' },
			retryable: true,
			refreshDocuments: false
		})
	})

	it('signals refresh only for successful commits', () => {
		const status = {
			status: 'SUCCESS',
			output: { sessionDocumentId: 'session-1', documents: [] }
		} as WorkflowStatus

		expect(
			mapIngestionWorkflowStatus({ kind: 'analysis', reference, status, progress: null })
				.refreshDocuments
		).toBe(false)
		expect(
			mapIngestionWorkflowStatus({ kind: 'commit', reference, status, progress: null })
				.refreshDocuments
		).toBe(true)
	})

	it('does not expose raw DBOS errors', () => {
		const mapped = mapIngestionWorkflowStatus({
			kind: 'commit',
			reference,
			status: {
				status: 'ERROR',
				error: { transcript: 'private transcript', databaseUrl: 'postgres://secret' }
			} as unknown as WorkflowStatus,
			progress: { stage: 'applying-mutations', completed: 1, total: 2 }
		})

		expect(mapped).toMatchObject({
			lifecycle: 'failed',
			error: {
				code: 'workflow.failed',
				message: 'The workflow could not be completed.'
			},
			failedStage: 'applying-mutations',
			refreshDocuments: false,
			retryable: true
		})
		expect(JSON.stringify(mapped)).not.toContain('private transcript')
		expect(JSON.stringify(mapped)).not.toContain('postgres://secret')
	})

	it('surfaces chronology commit load failures at the published import loading stage', () => {
		expect(
			mapIngestionWorkflowStatus<unknown, CampaignImportWorkflowProgress>({
				kind: 'commit',
				reference,
				status: { status: 'ERROR' } as WorkflowStatus,
				progress: { stage: 'loading-import-data', completed: 0, total: 1 }
			})
		).toMatchObject({
			lifecycle: 'failed',
			failedStage: 'loading-import-data',
			retryable: true
		})
	})

	it('marks cancelled workflows retryable with their last published stage', () => {
		expect(
			mapIngestionWorkflowStatus({
				kind: 'analysis',
				reference,
				status: { status: 'CANCELLED' } as WorkflowStatus,
				progress: { stage: 'analyzing-transcript', completed: 2, total: 4 }
			})
		).toMatchObject({
			lifecycle: 'cancelled',
			retryable: true,
			failedStage: 'analyzing-transcript',
			error: { code: 'workflow.cancelled' }
		})
	})
})
