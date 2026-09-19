import { describe, expect, it } from 'vitest'
import {
	deriveCampaignImportReviewView,
	hasServerCommitRequest,
	shouldPollCampaignImportLifecycle
} from './review-view.js'
import type { CampaignImportLifecycle } from '#lib/server/campaign-import/lifecycle.js'

const workflow = (lifecycle: 'not-started' | 'queued' | 'running' | 'succeeded' | 'failed') => ({
	campaignId: 'campaign',
	ingestionId: 'import',
	workflowId: 'workflow',
	lifecycle,
	refreshDocuments: false,
	retryable: lifecycle === 'not-started' || lifecycle === 'failed'
})

const lifecycle = (overrides: Partial<CampaignImportLifecycle> = {}): CampaignImportLifecycle => ({
	campaignId: 'campaign',
	ingestionId: 'import',
	phase: 'review',
	canDiscard: true,
	canFinish: false,
	chronologyDispatchFailed: false,
	workflows: {
		analysis: workflow('succeeded'),
		commit: workflow('not-started'),
		'chronology-analysis': workflow('not-started'),
		'chronology-commit': workflow('not-started')
	},
	...overrides
})

describe('campaign import review view', () => {
	it('preserves the page view priority', () => {
		expect(
			deriveCampaignImportReviewView({
				lifecycle: undefined,
				lifecycleError: true,
				draftLoaded: false,
				reviewLoaded: false,
				reviewDataError: false
			}).kind
		).toBe('lifecycle-error')
		expect(
			deriveCampaignImportReviewView({
				lifecycle: undefined,
				lifecycleError: false,
				draftLoaded: false,
				reviewLoaded: false,
				reviewDataError: false
			}).kind
		).toBe('lifecycle-loading')
		expect(
			deriveCampaignImportReviewView({
				lifecycle: lifecycle({
					baseCompletion: {
						schemaVersion: 1,
						kind: 'campaign-import-completion',
						campaignId: 'campaign',
						ingestionId: 'import',
						documents: [],
						finalized: true
					}
				}),
				lifecycleError: false,
				draftLoaded: true,
				reviewLoaded: false,
				reviewDataError: false
			}).kind
		).toBe('completion')
		expect(
			deriveCampaignImportReviewView({
				lifecycle: lifecycle(),
				lifecycleError: false,
				draftLoaded: true,
				reviewLoaded: true,
				reviewDataError: false
			}).kind
		).toBe('proposal-review')
		expect(
			deriveCampaignImportReviewView({
				lifecycle: lifecycle(),
				lifecycleError: false,
				draftLoaded: false,
				reviewLoaded: false,
				reviewDataError: true
			}).kind
		).toBe('review-data-error')
		expect(
			deriveCampaignImportReviewView({
				lifecycle: lifecycle({
					workflows: {
						analysis: workflow('running'),
						commit: workflow('not-started'),
						'chronology-analysis': workflow('not-started'),
						'chronology-commit': workflow('not-started')
					}
				}),
				lifecycleError: false,
				draftLoaded: false,
				reviewLoaded: false,
				reviewDataError: false
			}).kind
		).toBe('analysis-status')
	})

	it('keeps polling while retries wait or workflows are active', () => {
		expect(
			shouldPollCampaignImportLifecycle({
				lifecycle: lifecycle(),
				analysisRetryWaiting: true,
				commitRetryWaiting: false,
				chronologyRetryWaiting: false,
				chronologyCommitRetryWaiting: false,
				commitRequested: false,
				chronologyCommitRequested: false
			})
		).toBe(true)
		expect(
			hasServerCommitRequest(
				lifecycle({
					phase: 'chronology-review',
					workflows: {
						analysis: workflow('succeeded'),
						commit: workflow('succeeded'),
						'chronology-analysis': workflow('succeeded'),
						'chronology-commit': workflow('not-started')
					}
				})
			)
		).toBe(true)
	})
})
