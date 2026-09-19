import { describe, expect, it } from 'vitest'
import {
	analysisWorkflowId,
	campaignImportWorkflowDescriptors,
	campaignImportWorkflowKinds,
	commitWorkflowId,
	workflowLifecycleFromStatus
} from './contracts.js'
import { serializeWorkflowFailure, workflowStageError } from './failure.js'

describe('workflow contracts', () => {
	it('builds deterministic workflow ids scoped by campaign and ingestion', () => {
		expect(analysisWorkflowId('campaign-1', 'ingestion-1')).toBe(
			'loremaster:analysis:campaign-1:ingestion-1'
		)
		expect(commitWorkflowId('campaign-1', 'ingestion-1')).toBe(
			'loremaster:commit:campaign-1:ingestion-1'
		)
	})

	it('defines exactly four distinct campaign import workflow descriptors', () => {
		expect(campaignImportWorkflowKinds).toHaveLength(4)
		const descriptors = campaignImportWorkflowKinds.map(
			(kind) => campaignImportWorkflowDescriptors[kind]
		)
		expect(new Set(descriptors.map(({ workflowName }) => workflowName)).size).toBe(4)
		expect(new Set(descriptors.map(({ queueName }) => queueName)).size).toBe(4)
		expect(
			new Set(descriptors.map(({ workflowId }) => workflowId('campaign-1', 'ingestion-1'))).size
		).toBe(4)
	})

	it.each([
		['ENQUEUED', 'queued'],
		['DELAYED', 'queued'],
		['PENDING', 'running'],
		['SUCCESS', 'succeeded'],
		['ERROR', 'failed'],
		['MAX_RECOVERY_ATTEMPTS_EXCEEDED', 'failed'],
		['CANCELLED', 'cancelled']
	])('maps %s to %s', (status, lifecycle) => {
		expect(workflowLifecycleFromStatus(status)).toBe(lifecycle)
	})

	it('serializes Effect failures without exposing their cause', () => {
		const error = serializeWorkflowFailure({
			domain: 'vault',
			operation: 'updateDocument',
			cause: { databaseUrl: 'postgres://secret', document: 'private content' }
		})

		expect(error).toEqual({
			code: 'vault.updateDocument',
			message: 'A workflow stage could not be completed.'
		})
		expect(JSON.stringify(error)).not.toContain('secret')
		expect(workflowStageError({ token: 'private' })).toMatchObject({
			name: 'WorkflowStageError',
			code: 'workflow.failed',
			message: 'The workflow could not be completed.'
		})
	})
})
