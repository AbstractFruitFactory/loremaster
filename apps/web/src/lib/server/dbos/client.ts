import { DATABASE_URL } from '$app/env/private'
import { DBOSClient, type WorkflowStatus } from '@dbos-inc/dbos-sdk'
import {
	ANALYSIS_QUEUE_NAME,
	ANALYSIS_WORKFLOW_NAME,
	COMMIT_QUEUE_NAME,
	COMMIT_WORKFLOW_NAME,
	WORKFLOW_APPLICATION_NAME,
	WORKFLOW_PROGRESS_EVENT,
	WORKFLOW_SYSTEM_SCHEMA,
	type AnalysisWorkflowInput,
	campaignImportWorkflowDescriptors,
	type CampaignImportWorkflowKind,
	type CommitWorkflowInput,
	type WorkflowProgress,
	workflowLifecycleFromStatus
} from '@loremaster/core/workflows/contracts'
import { isWorkflowRetryable } from './status.js'

type EnqueueHandle = { workflowID: string }

export type IngestionDbosClient = {
	enqueuePortable<Result>(
		options: {
			queueName: string
			workflowName: string
			workflowID: string
			deduplicationID: string
			duplicationPolicy: 'return-existing'
		},
		positionalArgs: unknown[]
	): Promise<EnqueueHandle>
	getWorkflow(workflowId: string): Promise<WorkflowStatus | undefined>
	getEvent<Result>(
		workflowId: string,
		key: string,
		options: { timeoutSeconds: number }
	): Promise<Result | null>
	cancelWorkflow(workflowId: string): Promise<void>
	resumeWorkflow(workflowId: string, options?: { queueName?: string }): Promise<void>
}

let clientPromise: Promise<DBOSClient> | undefined

export const getDbosClient = (): Promise<DBOSClient> => {
	const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL || DATABASE_URL
	if (!systemDatabaseUrl) throw new Error('DBOS_SYSTEM_DATABASE_URL or DATABASE_URL is not set')
	clientPromise ??= DBOSClient.create({
		systemDatabaseUrl,
		systemDatabaseSchemaName: process.env.DBOS_SYSTEM_DATABASE_SCHEMA || WORKFLOW_SYSTEM_SCHEMA,
		applicationName: WORKFLOW_APPLICATION_NAME
	})
	return clientPromise
}

export const disposeDbosClient = async () => {
	const active = clientPromise
	clientPromise = undefined
	if (active) await (await active).destroy()
}

export class CampaignImportWorkflowRetryError extends Error {
	constructor(
		readonly kind: CampaignImportWorkflowKind,
		readonly lifecycle: 'queued' | 'running' | 'succeeded'
	) {
		super(`The ${kind} workflow cannot be retried while ${lifecycle}`)
		this.name = 'CampaignImportWorkflowRetryError'
	}
}

export const createIngestionDbosAdapter = (client: IngestionDbosClient) => {
	const enqueueCampaignImport = async (
		kind: CampaignImportWorkflowKind,
		campaignId: string,
		ingestionId: string
	) => {
		const descriptor = campaignImportWorkflowDescriptors[kind]
		const workflowId = descriptor.workflowId(campaignId, ingestionId)
		const handle = await client.enqueuePortable(
			{
				queueName: descriptor.queueName,
				workflowName: descriptor.workflowName,
				workflowID: workflowId,
				deduplicationID: workflowId,
				duplicationPolicy: 'return-existing'
			},
			[{ campaignId, ingestionId }]
		)
		return handle.workflowID
	}

	const retryCampaignImport = async (
		kind: CampaignImportWorkflowKind,
		campaignId: string,
		ingestionId: string
	) => {
		const descriptor = campaignImportWorkflowDescriptors[kind]
		const workflowId = descriptor.workflowId(campaignId, ingestionId)
		const status = await client.getWorkflow(workflowId)
		if (!status) return enqueueCampaignImport(kind, campaignId, ingestionId)
		const lifecycle = workflowLifecycleFromStatus(status.status)
		if (lifecycle === 'failed' || lifecycle === 'cancelled') {
			await client.resumeWorkflow(workflowId, { queueName: descriptor.queueName })
			return workflowId
		}
		if (isWorkflowRetryable(lifecycle)) {
			return enqueueCampaignImport(kind, campaignId, ingestionId)
		}
		throw new CampaignImportWorkflowRetryError(kind, lifecycle)
	}

	return {
		enqueueAnalysis: async (workflowId: string, input: AnalysisWorkflowInput) => {
			const handle = await client.enqueuePortable(
				{
					queueName: ANALYSIS_QUEUE_NAME,
					workflowName: ANALYSIS_WORKFLOW_NAME,
					workflowID: workflowId,
					deduplicationID: workflowId,
					duplicationPolicy: 'return-existing'
				},
				[input]
			)
			return handle.workflowID
		},
		enqueueCommit: async (workflowId: string, input: CommitWorkflowInput) => {
			const handle = await client.enqueuePortable(
				{
					queueName: COMMIT_QUEUE_NAME,
					workflowName: COMMIT_WORKFLOW_NAME,
					workflowID: workflowId,
					deduplicationID: workflowId,
					duplicationPolicy: 'return-existing'
				},
				[input]
			)
			return handle.workflowID
		},
		enqueueCampaignImport,
		retryCampaignImport,
		cancelAnalysis: async (workflowId: string) => {
			const status = await client.getWorkflow(workflowId)
			if (!status) return
			const lifecycle = workflowLifecycleFromStatus(status.status)
			if (lifecycle === 'succeeded' || lifecycle === 'failed' || lifecycle === 'cancelled') return
			await client.cancelWorkflow(workflowId)
		},
		getWorkflowState: async <
			Progress extends { stage: string; completed: number; total: number } = WorkflowProgress
		>(
			workflowId: string
		) => {
			const [status, progress] = await Promise.all([
				client.getWorkflow(workflowId),
				client.getEvent<Progress>(workflowId, WORKFLOW_PROGRESS_EVENT, {
					timeoutSeconds: 0
				})
			])
			return { status, progress }
		}
	}
}

export const getIngestionDbosAdapter = async () => createIngestionDbosAdapter(await getDbosClient())
