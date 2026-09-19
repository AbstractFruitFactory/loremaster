<script lang="ts">
	import { goto } from '$app/navigation'
	import { onMount } from 'svelte'
	import { isActiveWorkflowLifecycle } from '@loremaster/core/workflows/contracts'
	import type { PageProps } from './$types'
	import CampaignImportCompletion from '#lib/components/import/CampaignImportCompletion.svelte'
	import CampaignImportProposalReview from '#lib/components/import/CampaignImportProposalReview.svelte'
	import CampaignImportWorkflowStatus from '#lib/components/import/CampaignImportWorkflowStatus.svelte'
	import { createCampaignImportLifecyclePoller } from '#lib/import/lifecycle-polling.js'
	import {
		buildCampaignImportCommitSelection,
		buildCampaignImportReviewSnapshot,
		reviewChoicesFromServerState,
		type CampaignImportReviewState
	} from '#lib/import/review-state.js'
	import {
		createCampaignImportReviewStateSync,
		type CampaignImportReviewSyncStatus
	} from '#lib/import/review-state-sync.js'
	import type { CampaignImportLifecycle } from '#lib/server/campaign-import/lifecycle.js'
	import type { CampaignImportDraft } from '#lib/server/ingestion/types.js'
	import {
		commitCampaignImport,
		commitCampaignImportChronology,
		finishCampaignImport,
		getCampaignImport,
		getCampaignImportLifecycle,
		getCampaignImportReviewState,
		listDocuments,
		retryCampaignImportAnalysis,
		retryCampaignImportChronologyAnalysis,
		retryCampaignImportChronologyCommit,
		retryCampaignImportCommit,
		saveCampaignImportReviewState
	} from '../../data.remote'

	let { params }: PageProps = $props()

	const importReference = $derived({
		campaignId: params.campaignId,
		ingestionId: params.ingestionId
	})
	const lifecycleQuery = $derived(getCampaignImportLifecycle(importReference))
	const draftQuery = $derived(getCampaignImport(importReference))
	const reviewStateQuery = $derived(getCampaignImportReviewState(importReference))
	const lifecycle = $derived(lifecycleQuery.current)

	let draft = $state.raw<CampaignImportDraft>()
	let reviewChoices = $state.raw<CampaignImportReviewState>()
	let reviewSyncStatus = $state<CampaignImportReviewSyncStatus>({
		phase: 'idle',
		revision: 0
	})
	let reviewSync: ReturnType<typeof createCampaignImportReviewStateSync> | undefined
	let commitRequested = $state(false)
	let commitPending = $state(false)
	let commitError = $state('')
	let commitRetryPending = $state(false)
	let commitRetryWaiting = $state(false)
	let analysisRetryPending = $state(false)
	let analysisRetryWaiting = $state(false)
	let analysisRetryError = $state('')
	let chronologyRetryPending = $state(false)
	let chronologyRetryWaiting = $state(false)
	let chronologyRetryError = $state('')
	let chronologyCommitRequested = $state(false)
	let chronologyCommitPending = $state(false)
	let chronologyCommitRetryWaiting = $state(false)
	let chronologyCommitError = $state('')
	let finishPending = $state(false)
	let finishError = $state('')

	const httpStatus = (error: unknown) => {
		if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
		return typeof error.status === 'number' ? error.status : undefined
	}

	const isUncertainTransportError = (error: unknown) => {
		const status = httpStatus(error)
		return status === undefined || status >= 500
	}

	const hasServerCommitRequest = (current: CampaignImportLifecycle | undefined) =>
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

	const hasServerChronologyCommitRequest = (current: CampaignImportLifecycle | undefined) =>
		Boolean(
			current &&
			(current.chronologyCompletion ||
				current.phase === 'chronology-committing' ||
				current.workflows['chronology-commit'].lifecycle !== 'not-started')
		)

	const shouldPollLifecycle = () => {
		const current = lifecycleQuery.current
		if (!current) return true
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
			!current.baseCompletion &&
			current.workflows.commit.lifecycle === 'not-started'
		) {
			return true
		}
		if (
			chronologyCommitRequested &&
			!current.chronologyCompletion &&
			current.workflows['chronology-commit'].lifecycle === 'not-started'
		) {
			return true
		}
		if (
			Object.values(current.workflows).some((workflow) =>
				isActiveWorkflowLifecycle(workflow.lifecycle)
			)
		) {
			return true
		}
		return (
			current.phase === 'analyzing' ||
			current.phase === 'committing' ||
			current.phase === 'chronology-analyzing' ||
			current.phase === 'chronology-committing'
		)
	}

	const initializeReviewSync = async () => {
		if (!draft || reviewChoices) return
		try {
			await reviewStateQuery
		} catch {
			return
		}
		const persisted = reviewStateQuery.current
		if (!persisted) return
		reviewChoices = reviewChoicesFromServerState(draft.proposals, persisted)
		reviewSyncStatus = { phase: 'idle', revision: persisted.revision }
		reviewSync = createCampaignImportReviewStateSync({
			initialRevision: persisted.revision,
			save: (input) => saveCampaignImportReviewState({ ...importReference, ...input }),
			onStatus: (status) => {
				reviewSyncStatus = status
			}
		})
	}

	const loadDurableReviewData = async () => {
		const current = lifecycleQuery.current
		const analysisAvailable =
			current?.workflows.analysis.lifecycle === 'succeeded' || Boolean(current?.baseCompletion)
		if (!analysisAvailable) return
		if (!draft) {
			try {
				await draftQuery
				draft = draftQuery.current
			} catch {
				return
			}
		}
		await initializeReviewSync()
	}

	const changeReviewChoices = (choices: CampaignImportReviewState) => {
		if (!draft || !reviewSync || commitLocked) return
		reviewChoices = choices
		reviewSync.schedule(buildCampaignImportReviewSnapshot(draft.proposals, choices))
	}

	const finish = async () => {
		const current = lifecycleQuery.current
		if (finishPending || !current?.canFinish) return
		finishPending = true
		finishError = ''
		try {
			await finishCampaignImport(importReference)
			await listDocuments(params.campaignId).refresh()
			await goto(`/campaigns/${params.campaignId}`)
		} catch {
			finishError = 'Unable to finish this import. Try again.'
		} finally {
			finishPending = false
		}
	}

	const synchronizeLifecycle = async () => {
		const current = lifecycleQuery.current
		if (!current) return
		if (
			isActiveWorkflowLifecycle(current.workflows.analysis.lifecycle) ||
			current.workflows.analysis.lifecycle === 'succeeded'
		) {
			analysisRetryWaiting = false
		}
		if (
			isActiveWorkflowLifecycle(current.workflows.commit.lifecycle) ||
			current.workflows.commit.lifecycle === 'succeeded'
		) {
			commitRetryWaiting = false
		}
		if (
			isActiveWorkflowLifecycle(current.workflows['chronology-analysis'].lifecycle) ||
			current.workflows['chronology-analysis'].lifecycle === 'succeeded'
		) {
			chronologyRetryWaiting = false
		}
		if (
			isActiveWorkflowLifecycle(current.workflows['chronology-commit'].lifecycle) ||
			current.workflows['chronology-commit'].lifecycle === 'succeeded'
		) {
			chronologyCommitRetryWaiting = false
		}
		commitRequested ||= hasServerCommitRequest(current)
		chronologyCommitRequested ||= hasServerChronologyCommitRequest(current)
		await loadDurableReviewData()
	}

	const lifecyclePoller = createCampaignImportLifecyclePoller({
		refresh: () => lifecycleQuery.refresh(),
		shouldContinue: shouldPollLifecycle,
		afterRefresh: synchronizeLifecycle
	})

	const refreshAndPoll = async () => {
		await lifecyclePoller.refreshNow()
		lifecyclePoller.start()
	}

	onMount(() => {
		const initialize = async () => {
			try {
				await lifecycleQuery
			} catch {
				lifecyclePoller.start()
				return
			}
			await synchronizeLifecycle()
			lifecyclePoller.start()
		}
		void initialize()
		return () => {
			lifecyclePoller.dispose()
			reviewSync?.dispose()
		}
	})

	const commitLocked = $derived(
		commitRequested ||
			hasServerCommitRequest(lifecycle) ||
			reviewSyncStatus.phase === 'conflict' ||
			lifecycle?.workflows.commit.lifecycle === 'queued' ||
			lifecycle?.workflows.commit.lifecycle === 'running' ||
			lifecycle?.workflows.commit.lifecycle === 'succeeded'
	)

	const commitStatus = $derived.by(() => {
		const status = lifecycle?.workflows.commit
		if (!status || (status.lifecycle !== 'queued' && status.lifecycle !== 'running'))
			return undefined
		return status.progress
			? status.progress.stage.replaceAll('-', ' ')
			: 'Waiting for the campaign commit'
	})

	const commitReview = async () => {
		if (!draft || !reviewChoices || !reviewSync || commitLocked) return
		const selection = buildCampaignImportCommitSelection(draft.proposals, reviewChoices)
		if (selection.selectedProposalIds.length > 500 || selection.resolutions.length > 500) return
		commitRequested = true
		commitPending = true
		commitError = ''
		if (!(await reviewSync.flush())) {
			commitRequested = false
			commitPending = false
			commitError =
				reviewSyncStatus.phase === 'conflict'
					? 'This review changed elsewhere. Reload before committing.'
					: 'The latest review choices could not be saved. Try again.'
			return
		}
		const expectedReviewRevision = reviewSync.getAcknowledgedRevision()
		try {
			await commitCampaignImport({
				...importReference,
				...selection,
				expectedReviewRevision
			})
			await refreshAndPoll()
		} catch (error) {
			if (httpStatus(error) === 409) {
				commitError =
					'A different review selection is already being committed. Reload to follow it.'
				await refreshAndPoll()
			} else if (isUncertainTransportError(error)) {
				commitError = 'The commit request was not confirmed. Loremaster will keep checking it.'
				await refreshAndPoll()
			} else {
				commitRequested = false
				commitError = 'The selected proposals could not be committed. Review them and try again.'
			}
		} finally {
			commitPending = false
		}
	}

	const retryAnalysis = async () => {
		if (analysisRetryPending || !lifecycle?.workflows.analysis.retryable) return
		analysisRetryPending = true
		analysisRetryError = ''
		try {
			await retryCampaignImportAnalysis(importReference)
			analysisRetryWaiting = true
			await refreshAndPoll()
		} catch {
			analysisRetryWaiting = false
			analysisRetryError = 'The import analysis could not be restarted. Try again.'
		} finally {
			analysisRetryPending = false
		}
	}

	const retryCommit = async () => {
		if (commitRetryPending || !lifecycle?.workflows.commit.retryable) return
		commitRetryPending = true
		commitError = ''
		try {
			await retryCampaignImportCommit(importReference)
			commitRetryWaiting = true
			await refreshAndPoll()
		} catch {
			commitRetryWaiting = false
			commitError = 'The campaign commit could not be restarted. Try again.'
		} finally {
			commitRetryPending = false
		}
	}

	const retryChronology = async () => {
		if (chronologyRetryPending || !lifecycle?.workflows['chronology-analysis'].retryable) return
		chronologyRetryPending = true
		chronologyRetryError = ''
		try {
			await retryCampaignImportChronologyAnalysis(importReference)
			chronologyRetryWaiting = true
			await refreshAndPoll()
		} catch {
			chronologyRetryWaiting = false
			chronologyRetryError = 'Chronology analysis could not be restarted. Try again.'
		} finally {
			chronologyRetryPending = false
		}
	}

	const commitChronology = async (selectedChronologyIds: string[]) => {
		if (
			chronologyCommitRequested ||
			chronologyCommitPending ||
			selectedChronologyIds.length > 500
		) {
			return
		}
		chronologyCommitRequested = true
		chronologyCommitPending = true
		chronologyCommitError = ''
		try {
			await commitCampaignImportChronology({ ...importReference, selectedChronologyIds })
			await refreshAndPoll()
		} catch (error) {
			if (isUncertainTransportError(error)) {
				chronologyCommitError =
					'The chronology save was not confirmed. Loremaster will keep checking it.'
				await refreshAndPoll()
			} else {
				chronologyCommitRequested = false
				chronologyCommitError = 'Chronology could not be saved. Try again.'
			}
		} finally {
			chronologyCommitPending = false
		}
	}

	const retryChronologyCommit = async () => {
		if (chronologyCommitPending || !lifecycle?.workflows['chronology-commit'].retryable) {
			return
		}
		chronologyCommitPending = true
		chronologyCommitError = ''
		try {
			await retryCampaignImportChronologyCommit(importReference)
			chronologyCommitRetryWaiting = true
			await refreshAndPoll()
		} catch {
			chronologyCommitRetryWaiting = false
			chronologyCommitError = 'The chronology save could not be restarted. Try again.'
		} finally {
			chronologyCommitPending = false
		}
	}
</script>

<svelte:head><title>Review imported lore | Loremaster</title></svelte:head>

<section class="review-page" aria-labelledby="review-heading">
	<a class="back-link" href={`/campaigns/${params.campaignId}`}> ← Back to campaign workspace </a>
	<header class="page-heading">
		<p class="eyebrow">Campaign import</p>
		<h1 id="review-heading">Review imported lore</h1>
		<p>Review document proposals and choose exactly what becomes campaign canon.</p>
	</header>

	{#if !lifecycle}
		{#if lifecycleQuery.error}
			<div class="state error-state" role="alert">
				<strong>Campaign import status is temporarily unavailable.</strong>
				<p>Loremaster will keep trying to reconnect.</p>
			</div>
		{:else}
			<div class="state" role="status">Loading campaign import status…</div>
		{/if}
	{:else if lifecycle.baseCompletion && draft}
		<CampaignImportCompletion
			{draft}
			choices={reviewChoices}
			{lifecycle}
			chronologyRetry={{
				pending: chronologyRetryPending,
				error: chronologyRetryError,
				action: retryChronology
			}}
			chronologyCommit={{
				pending: chronologyCommitPending,
				error: chronologyCommitError,
				action: commitChronology,
				retry: retryChronologyCommit
			}}
			finish={{ pending: finishPending, error: finishError, action: finish }}
		/>
	{:else if draft && reviewChoices}
		<CampaignImportProposalReview
			{draft}
			choices={reviewChoices}
			syncStatus={reviewSyncStatus}
			disabled={commitLocked}
			{commitPending}
			{commitStatus}
			{commitError}
			retryCommit={commitRequested &&
			(lifecycle.workflows.commit.lifecycle === 'not-started' ||
				lifecycle.workflows.commit.lifecycle === 'failed' ||
				lifecycle.workflows.commit.lifecycle === 'cancelled') &&
			lifecycle.workflows.commit.retryable
				? {
						pending: commitRetryPending,
						failedStage: lifecycle.workflows.commit.failedStage,
						action: retryCommit
					}
				: undefined}
			onChoicesChange={changeReviewChoices}
			onCommit={commitReview}
		/>
	{:else if lifecycle.workflows.analysis.lifecycle === 'succeeded'}
		{#if draftQuery.error || reviewStateQuery.error}
			<div class="state error-state" role="alert">
				<strong>Saved review data could not be loaded.</strong>
				<p>Reload this page to try again.</p>
			</div>
		{:else}
			<div class="state" role="status">Loading your saved review choices…</div>
		{/if}
	{:else}
		<CampaignImportWorkflowStatus
			status={lifecycle.workflows.analysis}
			activeTitle={lifecycle.workflows.analysis.lifecycle === 'queued'
				? 'Import analysis queued'
				: 'Analyzing campaign sources'}
			waitingText="The document review will appear when analysis is ready."
			failureTitle={lifecycle.workflows.analysis.lifecycle === 'cancelled'
				? 'Analysis was cancelled'
				: 'Analysis could not finish'}
			failureText="No campaign documents have changed."
			transportError={Boolean(lifecycleQuery.error)}
			retry={{
				label: 'Retry analysis',
				pending: analysisRetryPending,
				action: retryAnalysis
			}}
		/>
		{#if analysisRetryError}<p class="error" role="alert">{analysisRetryError}</p>{/if}
	{/if}
</section>

<style>
	.review-page {
		--ink: #282016;
		box-sizing: border-box;
		width: min(78rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 5vw, 4rem);
		color: var(--ink);
	}

	.back-link,
	.eyebrow {
		color: #000;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.09em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.page-heading {
		margin: 1.25rem 0 1.75rem;
		color: #000;
	}

	.page-heading h1 {
		margin: 0.2rem 0 0.45rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.35rem);
	}

	.page-heading p:last-child,
	.state p {
		margin: 0;
	}

	.state {
		display: grid;
		gap: 0.45rem;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 94%);
		box-shadow: 0.25rem 0.25rem 0 #171d1a;
	}

	.error-state {
		border-color: #8d4037;
	}

	.error {
		color: #9b3d34;
	}
</style>
