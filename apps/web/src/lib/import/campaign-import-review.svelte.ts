import { isActiveWorkflowLifecycle } from '@loremaster/core/workflows/contracts'
import type { CampaignImportDraft } from '@loremaster/core/server/ingestion/types'
import { MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS } from './import-limits.js'
import { createCampaignImportLifecyclePoller } from './lifecycle-polling.js'
import {
	deriveCampaignImportReviewView,
	hasServerChronologyCommitRequest,
	hasServerCommitRequest,
	shouldPollCampaignImportLifecycle
} from './review-view.js'
import {
	buildCampaignImportCommitSelection,
	buildCampaignImportReviewSnapshot,
	reviewChoicesFromServerState,
	type CampaignImportReviewState
} from './review-state.js'
import {
	createCampaignImportReviewStateSync,
	type CampaignImportReviewSnapshot,
	type CampaignImportReviewSyncStatus
} from './review-state-sync.js'
import { httpStatus, isUncertainTransportError } from './http-error.js'
import { createWorkflowRetryAction } from './workflow-retry.js'
import type { CampaignImportLifecycle } from '#lib/server/campaign-import/lifecycle.js'

type AwaitableQuery<Value> = {
	current: Value
	error?: unknown
	refresh?: () => Promise<unknown>
} & PromiseLike<unknown>

export type CampaignImportReviewQueries = {
	lifecycle: AwaitableQuery<CampaignImportLifecycle | undefined> & {
		refresh: () => Promise<unknown>
	}
	draft: AwaitableQuery<CampaignImportDraft | undefined>
	reviewState: AwaitableQuery<Parameters<typeof reviewChoicesFromServerState>[1] | undefined>
}

export type CampaignImportReviewActions = {
	saveReviewState: (
		input: CampaignImportReviewSnapshot & {
			campaignId: string
			ingestionId: string
			expectedRevision: number
		}
	) => Promise<{ revision: number }>
	commit: (
		input: CampaignImportReviewSnapshot & {
			campaignId: string
			ingestionId: string
			expectedReviewRevision: number
		}
	) => Promise<unknown>
	commitChronology: (input: {
		campaignId: string
		ingestionId: string
		selectedChronologyIds: string[]
	}) => Promise<unknown>
	finish: (input: { campaignId: string; ingestionId: string }) => Promise<unknown>
	retryAnalysis: (input: { campaignId: string; ingestionId: string }) => Promise<unknown>
	retryCommit: (input: { campaignId: string; ingestionId: string }) => Promise<unknown>
	retryChronology: (input: { campaignId: string; ingestionId: string }) => Promise<unknown>
	retryChronologyCommit: (input: { campaignId: string; ingestionId: string }) => Promise<unknown>
	refreshDocuments: (campaignId: string) => Promise<unknown>
	gotoCampaign: (campaignId: string) => Promise<unknown>
}

export class CampaignImportReviewController {
	draft = $state.raw<CampaignImportDraft>()
	reviewChoices = $state.raw<CampaignImportReviewState>()
	reviewSyncStatus = $state<CampaignImportReviewSyncStatus>({
		phase: 'idle',
		revision: 0
	})
	commitRequested = $state(false)
	commitPending = $state(false)
	commitError = $state('')
	commitRetryPending = $state(false)
	commitRetryWaiting = $state(false)
	analysisRetryPending = $state(false)
	analysisRetryWaiting = $state(false)
	analysisRetryError = $state('')
	chronologyRetryPending = $state(false)
	chronologyRetryWaiting = $state(false)
	chronologyRetryError = $state('')
	chronologyCommitRequested = $state(false)
	chronologyCommitPending = $state(false)
	chronologyCommitRetryWaiting = $state(false)
	chronologyCommitError = $state('')
	finishPending = $state(false)
	finishError = $state('')

	#importReference: { campaignId: string; ingestionId: string }
	#queries: CampaignImportReviewQueries
	#actions: CampaignImportReviewActions
	#reviewSync: ReturnType<typeof createCampaignImportReviewStateSync> | undefined
	#poller: ReturnType<typeof createCampaignImportLifecyclePoller> | undefined

	constructor(
		importReference: { campaignId: string; ingestionId: string },
		queries: CampaignImportReviewQueries,
		actions: CampaignImportReviewActions
	) {
		this.#importReference = importReference
		this.#queries = queries
		this.#actions = actions
		this.#poller = createCampaignImportLifecyclePoller({
			refresh: () => this.#queries.lifecycle.refresh(),
			shouldContinue: () =>
				shouldPollCampaignImportLifecycle({
					lifecycle: this.#queries.lifecycle.current,
					analysisRetryWaiting: this.analysisRetryWaiting,
					commitRetryWaiting: this.commitRetryWaiting,
					chronologyRetryWaiting: this.chronologyRetryWaiting,
					chronologyCommitRetryWaiting: this.chronologyCommitRetryWaiting,
					commitRequested: this.commitRequested,
					chronologyCommitRequested: this.chronologyCommitRequested
				}),
			afterRefresh: () => this.synchronizeLifecycle()
		})
	}

	readonly view = $derived.by(() => this.#reviewView())
	readonly commitLocked = $derived.by(() => this.#commitIsLocked())
	readonly commitStatus = $derived.by(() => this.#activeCommitStatus())

	#reviewView() {
		return deriveCampaignImportReviewView({
			lifecycle: this.#queries.lifecycle.current,
			lifecycleError: Boolean(this.#queries.lifecycle.error),
			draftLoaded: Boolean(this.draft),
			reviewLoaded: Boolean(this.reviewChoices),
			reviewDataError: Boolean(this.#queries.draft.error || this.#queries.reviewState.error)
		})
	}

	#commitIsLocked() {
		return (
			this.commitRequested ||
			hasServerCommitRequest(this.#queries.lifecycle.current) ||
			this.reviewSyncStatus.phase === 'conflict' ||
			this.#queries.lifecycle.current?.workflows.commit.lifecycle === 'queued' ||
			this.#queries.lifecycle.current?.workflows.commit.lifecycle === 'running' ||
			this.#queries.lifecycle.current?.workflows.commit.lifecycle === 'succeeded'
		)
	}

	#activeCommitStatus() {
		const status = this.#queries.lifecycle.current?.workflows.commit
		if (!status || (status.lifecycle !== 'queued' && status.lifecycle !== 'running')) {
			return undefined
		}
		return status.progress
			? status.progress.stage.replaceAll('-', ' ')
			: 'Waiting for the campaign commit'
	}

	async start() {
		try {
			await this.#queries.lifecycle.refresh()
		} catch {
			this.#poller?.start()
			return
		}
		await this.synchronizeLifecycle()
		this.#poller?.start()
	}

	dispose() {
		this.#poller?.dispose()
		this.#reviewSync?.dispose()
	}

	changeReviewChoices = (choices: CampaignImportReviewState) => {
		if (!this.draft || !this.#reviewSync || this.commitLocked) return
		this.reviewChoices = choices
		this.#reviewSync.schedule(buildCampaignImportReviewSnapshot(this.draft.proposals, choices))
	}

	commitReview = async () => {
		if (!this.draft || !this.reviewChoices || !this.#reviewSync || this.commitLocked) return
		const selection = buildCampaignImportCommitSelection(this.draft.proposals, this.reviewChoices)
		if (
			selection.selectedProposalIds.length > MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS ||
			selection.resolutions.length > MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS
		) {
			return
		}
		this.commitRequested = true
		this.commitPending = true
		this.commitError = ''
		if (!(await this.#reviewSync.flush())) {
			this.commitRequested = false
			this.commitPending = false
			this.commitError =
				this.reviewSyncStatus.phase === 'conflict'
					? 'This review changed elsewhere. Reload before committing.'
					: 'The latest review choices could not be saved. Try again.'
			return
		}
		try {
			await this.#actions.commit({
				...this.#importReference,
				...selection,
				expectedReviewRevision: this.#reviewSync.getAcknowledgedRevision()
			})
			await this.refreshAndPoll()
		} catch (error) {
			if (httpStatus(error) === 409) {
				this.commitError =
					'A different review selection is already being committed. Reload to follow it.'
				await this.refreshAndPoll()
			} else if (isUncertainTransportError(error)) {
				this.commitError = 'The commit request was not confirmed. Loremaster will keep checking it.'
				await this.refreshAndPoll()
			} else {
				this.commitRequested = false
				this.commitError =
					'The selected proposals could not be committed. Review them and try again.'
			}
		} finally {
			this.commitPending = false
		}
	}

	retryAnalysis = async () => {
		this.analysisRetryPending = true
		await createWorkflowRetryAction({
			canRetry: () => Boolean(this.#queries.lifecycle.current?.workflows.analysis.retryable),
			invoke: () => this.#actions.retryAnalysis(this.#importReference),
			onWaiting: (waiting) => {
				this.analysisRetryWaiting = waiting
			},
			refresh: () => this.refreshAndPoll(),
			setError: (message) => {
				this.analysisRetryError = message
			},
			failureMessage: 'The import analysis could not be restarted. Try again.'
		})()
		this.analysisRetryPending = false
	}

	retryCommit = async () => {
		this.commitRetryPending = true
		await createWorkflowRetryAction({
			canRetry: () => Boolean(this.#queries.lifecycle.current?.workflows.commit.retryable),
			invoke: () => this.#actions.retryCommit(this.#importReference),
			onWaiting: (waiting) => {
				this.commitRetryWaiting = waiting
			},
			refresh: () => this.refreshAndPoll(),
			setError: (message) => {
				this.commitError = message
			},
			failureMessage: 'The campaign commit could not be restarted. Try again.'
		})()
		this.commitRetryPending = false
	}

	retryChronology = async () => {
		this.chronologyRetryPending = true
		await createWorkflowRetryAction({
			canRetry: () =>
				Boolean(this.#queries.lifecycle.current?.workflows['chronology-analysis'].retryable),
			invoke: () => this.#actions.retryChronology(this.#importReference),
			onWaiting: (waiting) => {
				this.chronologyRetryWaiting = waiting
			},
			refresh: () => this.refreshAndPoll(),
			setError: (message) => {
				this.chronologyRetryError = message
			},
			failureMessage: 'Chronology analysis could not be restarted. Try again.'
		})()
		this.chronologyRetryPending = false
	}

	retryChronologyCommit = async () => {
		this.chronologyCommitPending = true
		await createWorkflowRetryAction({
			canRetry: () =>
				Boolean(this.#queries.lifecycle.current?.workflows['chronology-commit'].retryable),
			invoke: () => this.#actions.retryChronologyCommit(this.#importReference),
			onWaiting: (waiting) => {
				this.chronologyCommitRetryWaiting = waiting
			},
			refresh: () => this.refreshAndPoll(),
			setError: (message) => {
				this.chronologyCommitError = message
			},
			failureMessage: 'The chronology save could not be restarted. Try again.'
		})()
		this.chronologyCommitPending = false
	}

	commitChronology = async (selectedChronologyIds: string[]) => {
		if (
			this.chronologyCommitRequested ||
			this.chronologyCommitPending ||
			selectedChronologyIds.length > MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS
		) {
			return
		}
		this.chronologyCommitRequested = true
		this.chronologyCommitPending = true
		this.chronologyCommitError = ''
		try {
			await this.#actions.commitChronology({
				...this.#importReference,
				selectedChronologyIds
			})
			await this.refreshAndPoll()
		} catch (error) {
			if (isUncertainTransportError(error)) {
				this.chronologyCommitError =
					'The chronology save was not confirmed. Loremaster will keep checking it.'
				await this.refreshAndPoll()
			} else {
				this.chronologyCommitRequested = false
				this.chronologyCommitError = 'Chronology could not be saved. Try again.'
			}
		} finally {
			this.chronologyCommitPending = false
		}
	}

	finish = async () => {
		const current = this.#queries.lifecycle.current
		if (this.finishPending || !current?.canFinish) return
		this.finishPending = true
		this.finishError = ''
		try {
			await this.#actions.finish(this.#importReference)
			await this.#actions.refreshDocuments(this.#importReference.campaignId)
			await this.#actions.gotoCampaign(this.#importReference.campaignId)
		} catch {
			this.finishError = 'Unable to finish this import. Try again.'
		} finally {
			this.finishPending = false
		}
	}

	private async refreshAndPoll() {
		await this.#poller?.refreshNow()
		this.#poller?.start()
	}

	private async synchronizeLifecycle() {
		const current = this.#queries.lifecycle.current
		if (!current) return
		if (
			isActiveWorkflowLifecycle(current.workflows.analysis.lifecycle) ||
			current.workflows.analysis.lifecycle === 'succeeded'
		) {
			this.analysisRetryWaiting = false
		}
		if (
			isActiveWorkflowLifecycle(current.workflows.commit.lifecycle) ||
			current.workflows.commit.lifecycle === 'succeeded'
		) {
			this.commitRetryWaiting = false
		}
		if (
			isActiveWorkflowLifecycle(current.workflows['chronology-analysis'].lifecycle) ||
			current.workflows['chronology-analysis'].lifecycle === 'succeeded'
		) {
			this.chronologyRetryWaiting = false
		}
		if (
			isActiveWorkflowLifecycle(current.workflows['chronology-commit'].lifecycle) ||
			current.workflows['chronology-commit'].lifecycle === 'succeeded'
		) {
			this.chronologyCommitRetryWaiting = false
		}
		this.commitRequested = this.commitRequested || hasServerCommitRequest(current)
		this.chronologyCommitRequested =
			this.chronologyCommitRequested || hasServerChronologyCommitRequest(current)
		await this.loadDurableReviewData()
	}

	private async loadDurableReviewData() {
		const current = this.#queries.lifecycle.current
		const analysisAvailable =
			current?.workflows.analysis.lifecycle === 'succeeded' || Boolean(current?.baseCompletion)
		if (!analysisAvailable) return
		if (!this.draft) {
			try {
				await this.#queries.draft
				this.draft = this.#queries.draft.current
			} catch {
				return
			}
		}
		await this.initializeReviewSync()
	}

	private async initializeReviewSync() {
		if (!this.draft || this.reviewChoices) return
		try {
			await this.#queries.reviewState
		} catch {
			return
		}
		const persisted = this.#queries.reviewState.current
		if (!persisted) return
		this.reviewChoices = reviewChoicesFromServerState(this.draft.proposals, persisted)
		this.reviewSyncStatus = { phase: 'idle', revision: persisted.revision }
		this.#reviewSync = createCampaignImportReviewStateSync({
			initialRevision: persisted.revision,
			save: (input) =>
				this.#actions.saveReviewState({
					...this.#importReference,
					...input
				}),
			onStatus: (status) => {
				this.reviewSyncStatus = status
			}
		})
	}
}
