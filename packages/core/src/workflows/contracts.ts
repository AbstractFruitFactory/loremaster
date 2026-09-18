import type { SessionIngestionDraft, SessionIngestionResult } from '../server/ingestion/types.js'

export const WORKFLOW_APPLICATION_NAME = 'loremaster-workflows'
export const WORKFLOW_SYSTEM_SCHEMA = 'dbos'
export const ANALYSIS_WORKFLOW_NAME = 'loremaster.session-analysis'
export const COMMIT_WORKFLOW_NAME = 'loremaster.session-commit'
export const ANALYSIS_QUEUE_NAME = 'loremaster-session-analysis'
export const COMMIT_QUEUE_NAME = 'loremaster-session-commit'
export const WORKFLOW_PROGRESS_EVENT = 'loremaster.progress'

export const analysisWorkflowId = (campaignId: string, ingestionId: string) =>
	`loremaster:analysis:${campaignId}:${ingestionId}`

export const commitWorkflowId = (campaignId: string, ingestionId: string) =>
	`loremaster:commit:${campaignId}:${ingestionId}`

export const workflowLifecycleStages = [
	'queued',
	'loading-transcript-data',
	'analyzing-transcript',
	'auditing-events',
	'resolving-entities',
	'inferring-chronology',
	'persisting-draft',
	'planning-commit',
	'applying-mutations',
	'completed'
] as const

export type WorkflowLifecycleStage = (typeof workflowLifecycleStages)[number]
export type WorkflowLifecycle =
	'not-started' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type WorkflowProgress = {
	stage: WorkflowLifecycleStage
	completed: number
	total: number
}

export type WorkflowError = {
	code: string
	message: string
}

export type WorkflowReference = {
	campaignId: string
	ingestionId: string
	workflowId: string
}

export type AnalysisStartReference = WorkflowReference

export type CommitStartReference = WorkflowReference & {
	sessionDocumentId: string
}

export type AnalysisWorkflowInput = {
	campaignId: string
	ingestionId: string
}

export type CommitWorkflowInput = AnalysisWorkflowInput

export type WorkflowStatusResult<Result> = WorkflowReference & {
	lifecycle: WorkflowLifecycle
	progress?: WorkflowProgress
	result?: Result
	error?: WorkflowError
	refreshDocuments: boolean
	retryable: boolean
}

export type AnalysisWorkflowStatus = WorkflowStatusResult<SessionIngestionDraft>
export type CommitWorkflowStatus = WorkflowStatusResult<SessionIngestionResult>

export const workflowLifecycleFromStatus = (status: string): WorkflowLifecycle => {
	if (status === 'SUCCESS') return 'succeeded'
	if (status === 'ERROR' || status === 'MAX_RECOVERY_ATTEMPTS_EXCEEDED') return 'failed'
	if (status === 'CANCELLED') return 'cancelled'
	if (status === 'ENQUEUED' || status === 'DELAYED') return 'queued'
	return 'running'
}
