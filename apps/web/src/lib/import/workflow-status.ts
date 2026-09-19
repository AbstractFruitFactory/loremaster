import type { CampaignImportWorkflowLifecycleStage } from '@loremaster/core/workflows/contracts'

export const campaignImportStageLabels = {
	queued: 'Waiting for a workflow worker',
	'loading-import-data': 'Loading imported sources',
	'analyzing-import-sources': 'Finding evidence-backed campaign facts',
	'reconciling-import-sources': 'Merging proposals by document',
	'building-import-draft': 'Preparing your document review',
	'planning-commit': 'Preparing selected document changes',
	'applying-mutations': 'Writing campaign documents',
	'finalizing-import': 'Finalizing source history',
	'inferring-import-chronology': 'Inferring event chronology',
	'planning-chronology-commit': 'Preparing chronology changes',
	'applying-chronology-mutations': 'Updating event chronology',
	'finalizing-chronology': 'Finalizing chronology',
	completed: 'Finishing up'
} as const satisfies Record<CampaignImportWorkflowLifecycleStage, string>

export const campaignImportStoppedAt = (stage: CampaignImportWorkflowLifecycleStage) =>
	`Stopped while ${campaignImportStageLabels[stage].toLocaleLowerCase()}.`
