import type {
	CampaignImportChronologyCommitResult,
	CampaignImportChronologyDraft,
	CampaignImportCommitResult,
	CampaignImportDraft,
	SessionIngestionDraft,
	SessionIngestionResult
} from '../server/ingestion/types.js'

export const WORKFLOW_APPLICATION_NAME = 'loremaster-workflows'
export const WORKFLOW_SYSTEM_SCHEMA = 'dbos'
export const ANALYSIS_WORKFLOW_NAME = 'loremaster.session-analysis'
export const COMMIT_WORKFLOW_NAME = 'loremaster.session-commit'
export const ANALYSIS_QUEUE_NAME = 'loremaster-session-analysis'
export const COMMIT_QUEUE_NAME = 'loremaster-session-commit'
export const CAMPAIGN_IMPORT_ANALYSIS_WORKFLOW_NAME = 'loremaster.campaign-import-analysis'
export const CAMPAIGN_IMPORT_COMMIT_WORKFLOW_NAME = 'loremaster.campaign-import-commit'
export const CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_WORKFLOW_NAME =
	'loremaster.campaign-import-chronology-analysis'
export const CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_WORKFLOW_NAME =
	'loremaster.campaign-import-chronology-commit'
export const CAMPAIGN_IMPORT_ANALYSIS_QUEUE_NAME = 'loremaster-campaign-import-analysis'
export const CAMPAIGN_IMPORT_COMMIT_QUEUE_NAME = 'loremaster-campaign-import-commit'
export const CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_QUEUE_NAME =
	'loremaster-campaign-import-chronology-analysis'
export const CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_QUEUE_NAME =
	'loremaster-campaign-import-chronology-commit'
export const WORKFLOW_PROGRESS_EVENT = 'loremaster.progress'

export const campaignImportWorkflowKinds = [
	'analysis',
	'commit',
	'chronology-analysis',
	'chronology-commit'
] as const
export type CampaignImportWorkflowKind = (typeof campaignImportWorkflowKinds)[number]

export const analysisWorkflowId = (campaignId: string, ingestionId: string) =>
	`loremaster:analysis:${campaignId}:${ingestionId}`

export const commitWorkflowId = (campaignId: string, ingestionId: string) =>
	`loremaster:commit:${campaignId}:${ingestionId}`

export const campaignImportAnalysisWorkflowId = (campaignId: string, ingestionId: string) =>
	`loremaster:campaign-import:analysis:${campaignId}:${ingestionId}`

export const campaignImportCommitWorkflowId = (campaignId: string, ingestionId: string) =>
	`loremaster:campaign-import:commit:${campaignId}:${ingestionId}`

export const campaignImportChronologyAnalysisWorkflowId = (
	campaignId: string,
	ingestionId: string
) => `loremaster:campaign-import:chronology-analysis:${campaignId}:${ingestionId}`

export const campaignImportChronologyCommitWorkflowId = (campaignId: string, ingestionId: string) =>
	`loremaster:campaign-import:chronology-commit:${campaignId}:${ingestionId}`

export type CampaignImportWorkflowDescriptor = {
	kind: CampaignImportWorkflowKind
	queueName: string
	workflowName: string
	workflowId: (campaignId: string, ingestionId: string) => string
}

export const campaignImportWorkflowDescriptors = {
	analysis: {
		kind: 'analysis',
		queueName: CAMPAIGN_IMPORT_ANALYSIS_QUEUE_NAME,
		workflowName: CAMPAIGN_IMPORT_ANALYSIS_WORKFLOW_NAME,
		workflowId: campaignImportAnalysisWorkflowId
	},
	commit: {
		kind: 'commit',
		queueName: CAMPAIGN_IMPORT_COMMIT_QUEUE_NAME,
		workflowName: CAMPAIGN_IMPORT_COMMIT_WORKFLOW_NAME,
		workflowId: campaignImportCommitWorkflowId
	},
	'chronology-analysis': {
		kind: 'chronology-analysis',
		queueName: CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_QUEUE_NAME,
		workflowName: CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_WORKFLOW_NAME,
		workflowId: campaignImportChronologyAnalysisWorkflowId
	},
	'chronology-commit': {
		kind: 'chronology-commit',
		queueName: CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_QUEUE_NAME,
		workflowName: CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_WORKFLOW_NAME,
		workflowId: campaignImportChronologyCommitWorkflowId
	}
} as const satisfies Record<CampaignImportWorkflowKind, CampaignImportWorkflowDescriptor>

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
export const campaignImportWorkflowLifecycleStages = [
	'queued',
	'loading-import-data',
	'analyzing-import-sources',
	'reconciling-import-sources',
	'building-import-draft',
	'planning-commit',
	'applying-mutations',
	'finalizing-import',
	'inferring-import-chronology',
	'planning-chronology-commit',
	'applying-chronology-mutations',
	'finalizing-chronology',
	'completed'
] as const
export type CampaignImportWorkflowLifecycleStage =
	(typeof campaignImportWorkflowLifecycleStages)[number]
export type WorkflowLifecycle =
	'not-started' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type WorkflowProgress = {
	stage: WorkflowLifecycleStage
	completed: number
	total: number
}
export type CampaignImportWorkflowProgress = {
	stage: CampaignImportWorkflowLifecycleStage
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
export type CampaignImportAnalysisWorkflowInput = AnalysisWorkflowInput
export type CampaignImportCommitWorkflowInput = AnalysisWorkflowInput
export type CampaignImportChronologyAnalysisWorkflowInput = AnalysisWorkflowInput
export type CampaignImportChronologyCommitWorkflowInput = AnalysisWorkflowInput

export type WorkflowStatusResult<Result, Progress = WorkflowProgress> = WorkflowReference & {
	lifecycle: WorkflowLifecycle
	progress?: Progress
	failedStage?: Progress extends { stage: infer Stage } ? Stage : never
	result?: Result
	error?: WorkflowError
	refreshDocuments: boolean
	retryable: boolean
}

export type AnalysisWorkflowStatus = WorkflowStatusResult<SessionIngestionDraft>
export type CommitWorkflowStatus = WorkflowStatusResult<SessionIngestionResult>
export type CampaignImportAnalysisWorkflowStatus = WorkflowStatusResult<
	CampaignImportDraft,
	CampaignImportWorkflowProgress
>
export type CampaignImportCommitWorkflowStatus = WorkflowStatusResult<
	CampaignImportCommitResult,
	CampaignImportWorkflowProgress
>
export type CampaignImportChronologyAnalysisWorkflowStatus = WorkflowStatusResult<
	CampaignImportChronologyDraft,
	CampaignImportWorkflowProgress
>
export type CampaignImportChronologyCommitWorkflowStatus = WorkflowStatusResult<
	CampaignImportChronologyCommitResult,
	CampaignImportWorkflowProgress
>

export const workflowLifecycleFromStatus = (status: string): WorkflowLifecycle => {
	if (status === 'SUCCESS') return 'succeeded'
	if (status === 'ERROR' || status === 'MAX_RECOVERY_ATTEMPTS_EXCEEDED') return 'failed'
	if (status === 'CANCELLED') return 'cancelled'
	if (status === 'ENQUEUED' || status === 'DELAYED') return 'queued'
	return 'running'
}

export const isTerminalWorkflowLifecycle = (lifecycle: WorkflowLifecycle) =>
	lifecycle === 'succeeded' || lifecycle === 'failed' || lifecycle === 'cancelled'

export const isActiveWorkflowLifecycle = (lifecycle: WorkflowLifecycle) =>
	lifecycle === 'queued' || lifecycle === 'running'
