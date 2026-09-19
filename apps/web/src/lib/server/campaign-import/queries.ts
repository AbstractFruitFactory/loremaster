import { error } from '@sveltejs/kit'
import { campaignImport } from '#lib/server/app.js'
import { logFailure } from '#lib/server/failure.js'
import type {
	CampaignImportChronologyDraft,
	CampaignImportDraft,
	CampaignImportReviewState,
	CampaignImportSummary
} from '@loremaster/core/server/ingestion/types'
import { mapWithConcurrency } from './bounded-map.js'
import { deriveCampaignImportLifecycle, type CampaignImportLifecycle } from './lifecycle.js'
import { authorizeCampaignImport, failCampaignImportRead, runCore } from './http.js'
import { getCampaignImportWorkflowStatuses } from './workflow-status.js'

const campaignImportListConcurrency = 4

export const readCampaignImportLifecycleState = (campaignId: string, ingestionId: string) =>
	runCore(campaignImport.commitOperations.getLifecycleState(campaignId, ingestionId), (failure) =>
		failCampaignImportRead(
			failure,
			'Campaign import was not found',
			'Unable to read campaign import state'
		)
	)

export const campaignImportCleanupStarted = (campaignId: string, ingestionId: string) =>
	runCore(campaignImport.commitOperations.isCleanupStarted(campaignId, ingestionId), (failure) => {
		logFailure(failure)
		error(500, 'Unable to verify campaign import cleanup state')
	})

export const getCampaignImportLifecycleOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportLifecycle> => {
	await authorizeCampaignImport(campaignId)
	const [state, statuses] = await Promise.all([
		readCampaignImportLifecycleState(campaignId, ingestionId),
		getCampaignImportWorkflowStatuses(campaignId, ingestionId)
	])
	return deriveCampaignImportLifecycle(state, statuses)
}

export const listCampaignImportsOperation = async (
	campaignId: string
): Promise<CampaignImportSummary[]> => {
	await authorizeCampaignImport(campaignId)
	const summaries = await runCore(campaignImport.commitOperations.list(campaignId), (failure) => {
		logFailure(failure)
		error(500, 'Unable to list campaign imports')
	})
	return mapWithConcurrency(summaries, campaignImportListConcurrency, async (summary) => {
		const [state, statuses] = await Promise.all([
			readCampaignImportLifecycleState(campaignId, summary.ingestionId),
			getCampaignImportWorkflowStatuses(campaignId, summary.ingestionId)
		])
		const lifecycle = deriveCampaignImportLifecycle(state, statuses)
		return { ...summary, phase: lifecycle.phase, canDiscard: lifecycle.canDiscard }
	})
}

export const getCampaignImportOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportDraft> => {
	await authorizeCampaignImport(campaignId)
	return runCore(campaignImport.getDraft(campaignId, ingestionId), (failure) =>
		failCampaignImportRead(
			failure,
			'Campaign import analysis was not found',
			'Unable to load campaign import analysis'
		)
	)
}

export const getCampaignImportReviewStateOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportReviewState> => {
	await authorizeCampaignImport(campaignId)
	return runCore(campaignImport.getReviewState(campaignId, ingestionId), (failure) =>
		failCampaignImportRead(
			failure,
			'Campaign import review state was not found',
			'Unable to load campaign import review state'
		)
	)
}

export const getCampaignImportChronologyOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportChronologyDraft> => {
	await authorizeCampaignImport(campaignId)
	return runCore(campaignImport.chronology.getDraft(campaignId, ingestionId), (failure) =>
		failCampaignImportRead(
			failure,
			'Campaign import chronology was not found',
			'Unable to load campaign import chronology'
		)
	)
}
