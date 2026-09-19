import { error } from '@sveltejs/kit'
import { getIngestionDbosAdapter } from '#lib/server/dbos/client.js'
import { mapIngestionWorkflowStatus } from '#lib/server/dbos/status.js'
import type {
	CampaignImportChronologyCommitResult,
	CampaignImportChronologyDraft,
	CampaignImportCommitResult,
	CampaignImportDraft
} from '@loremaster/core/server/ingestion/types'
import {
	campaignImportWorkflowDescriptors,
	type CampaignImportWorkflowKind,
	type CampaignImportWorkflowProgress,
	type WorkflowStatusResult
} from '@loremaster/core/workflows/contracts'

export type CampaignImportWorkflowResultByKind = {
	analysis: CampaignImportDraft
	commit: CampaignImportCommitResult
	'chronology-analysis': CampaignImportChronologyDraft
	'chronology-commit': CampaignImportChronologyCommitResult
}

export type CampaignImportWorkflowLifecycleStatus<
	Kind extends CampaignImportWorkflowKind = CampaignImportWorkflowKind
> = WorkflowStatusResult<CampaignImportWorkflowResultByKind[Kind], CampaignImportWorkflowProgress>

export type CampaignImportWorkflowStatuses = {
	[Kind in CampaignImportWorkflowKind]: CampaignImportWorkflowLifecycleStatus<Kind>
}

const workflowStatus = async <Kind extends CampaignImportWorkflowKind>(
	kind: Kind,
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportWorkflowLifecycleStatus<Kind>> => {
	const descriptor = campaignImportWorkflowDescriptors[kind]
	const workflowId = descriptor.workflowId(campaignId, ingestionId)
	try {
		const dbos = await getIngestionDbosAdapter()
		return mapIngestionWorkflowStatus<
			CampaignImportWorkflowResultByKind[Kind],
			CampaignImportWorkflowProgress
		>({
			kind: kind === 'analysis' || kind === 'chronology-analysis' ? 'analysis' : 'commit',
			reference: { campaignId, ingestionId, workflowId },
			...(await dbos.getWorkflowState<CampaignImportWorkflowProgress>(workflowId))
		})
	} catch (cause) {
		console.error(`[campaign-import-${kind}.status]`, cause)
		error(503, 'Campaign import workflow status is temporarily unavailable')
	}
}

export const getCampaignImportWorkflowStatuses = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportWorkflowStatuses> => {
	const [analysis, commit, chronologyAnalysis, chronologyCommit] = await Promise.all([
		workflowStatus('analysis', campaignId, ingestionId),
		workflowStatus('commit', campaignId, ingestionId),
		workflowStatus('chronology-analysis', campaignId, ingestionId),
		workflowStatus('chronology-commit', campaignId, ingestionId)
	])
	return {
		analysis,
		commit,
		'chronology-analysis': chronologyAnalysis,
		'chronology-commit': chronologyCommit
	}
}
