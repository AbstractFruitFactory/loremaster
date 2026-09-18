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
	type CommitWorkflowInput,
	type WorkflowProgress,
	workflowLifecycleFromStatus
} from '@loremaster/core/workflows/contracts'

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

export const createIngestionDbosAdapter = (client: IngestionDbosClient) => ({
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
	cancelAnalysis: async (workflowId: string) => {
		const status = await client.getWorkflow(workflowId)
		if (!status) return
		const lifecycle = workflowLifecycleFromStatus(status.status)
		if (lifecycle === 'succeeded' || lifecycle === 'failed' || lifecycle === 'cancelled') return
		await client.cancelWorkflow(workflowId)
	},
	getWorkflowState: async (workflowId: string) => ({
		status: await client.getWorkflow(workflowId),
		progress: await client.getEvent<WorkflowProgress>(workflowId, WORKFLOW_PROGRESS_EVENT, {
			timeoutSeconds: 0
		})
	})
})

export const getIngestionDbosAdapter = async () => createIngestionDbosAdapter(await getDbosClient())
