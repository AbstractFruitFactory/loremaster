import type { WorkflowStatus } from '@dbos-inc/dbos-sdk'
import {
	ANALYSIS_QUEUE_NAME,
	ANALYSIS_WORKFLOW_NAME,
	COMMIT_QUEUE_NAME,
	COMMIT_WORKFLOW_NAME
} from '@loremaster/core/workflows/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createIngestionDbosAdapter, type IngestionDbosClient } from './client'
import { mapIngestionWorkflowStatus } from './status'

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
			getEvent: vi.fn()
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
	})
})

describe('ingestion workflow status mapping', () => {
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
			progress: null
		})

		expect(mapped).toMatchObject({
			lifecycle: 'failed',
			error: {
				code: 'workflow.failed',
				message: 'The workflow could not be completed.'
			},
			refreshDocuments: false
		})
		expect(JSON.stringify(mapped)).not.toContain('private transcript')
		expect(JSON.stringify(mapped)).not.toContain('postgres://secret')
	})
})
