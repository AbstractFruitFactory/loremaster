import type {
	CampaignImportChronologyCompletionData,
	CampaignImportChronologyDraft,
	CampaignImportCompletionData,
	CampaignImportLifecycleStorageState,
	CampaignImportPhase
} from '@loremaster/core/server/ingestion/types'
import {
	campaignImportWorkflowKinds,
	isActiveWorkflowLifecycle,
	type CampaignImportWorkflowKind,
	type CampaignImportWorkflowProgress,
	type WorkflowStatusResult
} from '@loremaster/core/workflows/contracts'

export type CampaignImportWorkflowLifecycleStatus = WorkflowStatusResult<
	unknown,
	CampaignImportWorkflowProgress
>

export type CampaignImportWorkflowStatuses = Record<
	CampaignImportWorkflowKind,
	CampaignImportWorkflowLifecycleStatus
>

export type CampaignImportFinishDisabledReason =
	| 'workflow-active'
	| 'base-import-incomplete'
	| 'chronology-dispatch-failed'
	| 'chronology-analysis-incomplete'
	| 'chronology-review-required'
	| 'chronology-commit-active'
	| 'chronology-commit-incomplete'
	| 'chronology-commit-failed'

export type CampaignImportLifecycle = {
	campaignId: string
	ingestionId: string
	phase: CampaignImportPhase
	canDiscard: boolean
	canFinish: boolean
	finishDisabledReason?: CampaignImportFinishDisabledReason
	baseCompletion?: CampaignImportCompletionData
	chronologyDraft?: CampaignImportChronologyDraft
	chronologyCompletion?: CampaignImportChronologyCompletionData
	chronologyDispatchFailed: boolean
	workflows: CampaignImportWorkflowStatuses
}

const failed = (status: CampaignImportWorkflowLifecycleStatus) =>
	status.lifecycle === 'failed' || status.lifecycle === 'cancelled'

const storagePhase = (state: CampaignImportLifecycleStorageState): CampaignImportPhase => {
	if (state.chronologyCompletion) return 'ready-to-finish'
	if (state.chronologyCommitData) return 'chronology-committing'
	if (state.chronologyDraft) return 'chronology-review'
	if (state.completion) return 'chronology-analyzing'
	if (state.commitRequested) return 'committing'
	if (state.draft) return 'review'
	return 'analyzing'
}

export const deriveCampaignImportLifecycle = (
	state: CampaignImportLifecycleStorageState,
	workflows: CampaignImportWorkflowStatuses
): CampaignImportLifecycle => {
	const anyActive = campaignImportWorkflowKinds.some((kind) =>
		isActiveWorkflowLifecycle(workflows[kind].lifecycle)
	)
	const chronologyWorkflowAdvanced = ['queued', 'running', 'succeeded'].includes(
		workflows['chronology-analysis'].lifecycle
	)
	const hasPersistedChronology = Boolean(state.chronologyDraft || state.chronologyCompletion)
	const chronologyDispatchFailed =
		(state.chronologyDispatch?.status === 'failed' &&
			!chronologyWorkflowAdvanced &&
			!hasPersistedChronology) ||
		(Boolean(state.completion) &&
			!state.chronologyDispatch &&
			workflows['chronology-analysis'].lifecycle === 'not-started' &&
			!hasPersistedChronology)
	const relevantFailure =
		(!state.draft && failed(workflows.analysis)) ||
		(!state.completion && failed(workflows.commit)) ||
		(!hasPersistedChronology && failed(workflows['chronology-analysis'])) ||
		(Boolean(state.chronologyCommitData) &&
			!state.chronologyCompletion &&
			failed(workflows['chronology-commit']))

	let phase = storagePhase(state)
	if (relevantFailure || chronologyDispatchFailed) {
		phase = 'failed'
	} else if (!state.draft && isActiveWorkflowLifecycle(workflows.analysis.lifecycle)) {
		phase = 'analyzing'
	} else if (!state.completion && isActiveWorkflowLifecycle(workflows.commit.lifecycle)) {
		phase = 'committing'
	} else if (
		state.completion &&
		!state.chronologyDraft &&
		!state.chronologyCompletion &&
		isActiveWorkflowLifecycle(workflows['chronology-analysis'].lifecycle)
	) {
		phase = 'chronology-analyzing'
	} else if (
		state.chronologyCommitData &&
		!state.chronologyCompletion &&
		isActiveWorkflowLifecycle(workflows['chronology-commit'].lifecycle)
	) {
		phase = 'chronology-committing'
	} else if (
		!state.chronologyCommitData &&
		!state.chronologyCompletion &&
		workflows['chronology-analysis'].lifecycle === 'succeeded' &&
		state.chronologyDraft
	) {
		phase = state.chronologyDraft.chronology.length ? 'chronology-review' : 'chronology-analyzing'
	}

	let finishDisabledReason: CampaignImportFinishDisabledReason | undefined
	if (anyActive) finishDisabledReason = 'workflow-active'
	else if (!state.completion) finishDisabledReason = 'base-import-incomplete'
	else if (state.chronologyCommitData) {
		if (state.chronologyCompletion?.kind === 'campaign-import-chronology-completion') {
			finishDisabledReason = undefined
		} else if (failed(workflows['chronology-commit'])) {
			finishDisabledReason = 'chronology-commit-failed'
		} else {
			finishDisabledReason = 'chronology-commit-incomplete'
		}
	} else if (state.chronologyCompletion?.kind === 'campaign-import-chronology-no-relations') {
		finishDisabledReason = undefined
	} else if (
		!chronologyDispatchFailed &&
		!failed(workflows['chronology-analysis']) &&
		workflows['chronology-analysis'].lifecycle !== 'succeeded'
	) {
		finishDisabledReason = 'chronology-analysis-incomplete'
	} else if (
		workflows['chronology-analysis'].lifecycle === 'succeeded' &&
		!state.chronologyDraft &&
		!state.chronologyCompletion
	) {
		finishDisabledReason = 'chronology-analysis-incomplete'
	} else if (
		workflows['chronology-analysis'].lifecycle === 'succeeded' &&
		state.chronologyDraft?.chronology.length === 0
	) {
		finishDisabledReason = 'chronology-analysis-incomplete'
	}

	return {
		campaignId: state.request.campaignId,
		ingestionId: state.request.ingestionId,
		phase,
		canDiscard: !state.commitRequested,
		canFinish: finishDisabledReason === undefined,
		...(finishDisabledReason ? { finishDisabledReason } : {}),
		...(state.completion ? { baseCompletion: state.completion } : {}),
		...(state.chronologyDraft ? { chronologyDraft: state.chronologyDraft } : {}),
		...(state.chronologyCompletion ? { chronologyCompletion: state.chronologyCompletion } : {}),
		chronologyDispatchFailed,
		workflows
	}
}
