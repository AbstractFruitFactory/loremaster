import { isActiveWorkflowLifecycle } from '@loremaster/core/workflows/contracts'
import type { CampaignImportLifecycle } from '#lib/server/campaign-import/lifecycle.js'

export type CampaignImportReviewView =
	| { kind: 'lifecycle-error' }
	| { kind: 'lifecycle-loading' }
	| { kind: 'completion' }
	| { kind: 'proposal-review' }
	| { kind: 'review-data-error' }
	| { kind: 'review-data-loading' }
	| { kind: 'analysis-status' }

export const hasServerCommitRequest = (current: CampaignImportLifecycle | undefined) =>
	Boolean(
		current &&
		(current.baseCompletion ||
			current.phase === 'committing' ||
			current.phase === 'chronology-analyzing' ||
			current.phase === 'chronology-review' ||
			current.phase === 'chronology-committing' ||
			current.phase === 'ready-to-finish' ||
			current.workflows.commit.lifecycle !== 'not-started')
	)

export const hasServerChronologyCommitRequest = (current: CampaignImportLifecycle | undefined) =>
	Boolean(
		current &&
		(current.chronologyCompletion ||
			current.phase === 'chronology-committing' ||
			current.workflows['chronology-commit'].lifecycle !== 'not-started')
	)

export const shouldPollCampaignImportLifecycle = ({
	lifecycle,
	analysisRetryWaiting,
	commitRetryWaiting,
	chronologyRetryWaiting,
	chronologyCommitRetryWaiting,
	commitRequested,
	chronologyCommitRequested
}: {
	lifecycle: CampaignImportLifecycle | undefined
	analysisRetryWaiting: boolean
	commitRetryWaiting: boolean
	chronologyRetryWaiting: boolean
	chronologyCommitRetryWaiting: boolean
	commitRequested: boolean
	chronologyCommitRequested: boolean
}) => {
	if (!lifecycle) return true
	if (
		analysisRetryWaiting ||
		commitRetryWaiting ||
		chronologyRetryWaiting ||
		chronologyCommitRetryWaiting
	) {
		return true
	}
	if (
		commitRequested &&
		!lifecycle.baseCompletion &&
		lifecycle.workflows.commit.lifecycle === 'not-started'
	) {
		return true
	}
	if (
		chronologyCommitRequested &&
		!lifecycle.chronologyCompletion &&
		lifecycle.workflows['chronology-commit'].lifecycle === 'not-started'
	) {
		return true
	}
	if (
		Object.values(lifecycle.workflows).some((workflow) =>
			isActiveWorkflowLifecycle(workflow.lifecycle)
		)
	) {
		return true
	}
	return (
		lifecycle.phase === 'analyzing' ||
		lifecycle.phase === 'committing' ||
		lifecycle.phase === 'chronology-analyzing' ||
		lifecycle.phase === 'chronology-committing'
	)
}

export const deriveCampaignImportReviewView = ({
	lifecycle,
	lifecycleError,
	draftLoaded,
	reviewLoaded,
	reviewDataError
}: {
	lifecycle: CampaignImportLifecycle | undefined
	lifecycleError: boolean
	draftLoaded: boolean
	reviewLoaded: boolean
	reviewDataError: boolean
}): CampaignImportReviewView => {
	if (!lifecycle) {
		return lifecycleError ? { kind: 'lifecycle-error' } : { kind: 'lifecycle-loading' }
	}
	if (lifecycle.baseCompletion && draftLoaded) return { kind: 'completion' }
	if (draftLoaded && reviewLoaded) return { kind: 'proposal-review' }
	if (lifecycle.workflows.analysis.lifecycle === 'succeeded') {
		return reviewDataError ? { kind: 'review-data-error' } : { kind: 'review-data-loading' }
	}
	return { kind: 'analysis-status' }
}
