<script lang="ts">
	import { goto } from '$app/navigation'
	import { untrack } from 'svelte'
	import CampaignImportCompletion from './CampaignImportCompletion.svelte'
	import CampaignImportProposalReview from './CampaignImportProposalReview.svelte'
	import CampaignImportWorkflowStatus from './CampaignImportWorkflowStatus.svelte'
	import {
		CampaignImportReviewController,
		type CampaignImportReviewActions,
		type CampaignImportReviewQueries
	} from '#lib/import/campaign-import-review.svelte.js'

	let {
		campaignId,
		ingestionId,
		queries,
		actions
	}: {
		campaignId: string
		ingestionId: string
		queries: CampaignImportReviewQueries
		actions: Omit<CampaignImportReviewActions, 'gotoCampaign' | 'refreshDocuments'> & {
			refreshDocuments: CampaignImportReviewActions['refreshDocuments']
		}
	} = $props()

	const controller = untrack(
		() =>
			new CampaignImportReviewController({ campaignId, ingestionId }, queries, {
				...actions,
				gotoCampaign: (id) => goto(`/campaigns/${id}`)
			})
	)
	const lifecycle = $derived(queries.lifecycle.current)

	$effect(() => {
		void controller.start()
		return () => controller.dispose()
	})
</script>

<svelte:head><title>Review imported lore | Loremaster</title></svelte:head>

<section class="review-page" aria-labelledby="review-heading">
	<a class="back-link" href={`/campaigns/${campaignId}`}> ← Back to campaign workspace </a>
	<header class="page-heading">
		<p class="eyebrow">Campaign import</p>
		<h1 id="review-heading">Review imported lore</h1>
		<p>Review document proposals and choose exactly what becomes campaign canon.</p>
	</header>

	{#if controller.view.kind === 'lifecycle-error'}
		<div class="state error-state" role="alert">
			<strong>Campaign import status is temporarily unavailable.</strong>
			<p>Loremaster will keep trying to reconnect.</p>
		</div>
	{:else if controller.view.kind === 'lifecycle-loading'}
		<div class="state" role="status">Loading campaign import status…</div>
	{:else if controller.view.kind === 'completion' && controller.draft && lifecycle}
		<CampaignImportCompletion
			draft={controller.draft}
			choices={controller.reviewChoices}
			{lifecycle}
			chronologyRetry={{
				pending: controller.chronologyRetryPending,
				error: controller.chronologyRetryError,
				action: controller.retryChronology
			}}
			chronologyCommit={{
				pending: controller.chronologyCommitPending,
				error: controller.chronologyCommitError,
				action: controller.commitChronology,
				retry: controller.retryChronologyCommit
			}}
			finish={{
				pending: controller.finishPending,
				error: controller.finishError,
				action: controller.finish
			}}
		/>
	{:else if controller.view.kind === 'proposal-review' && controller.draft && controller.reviewChoices && lifecycle}
		<CampaignImportProposalReview
			draft={controller.draft}
			choices={controller.reviewChoices}
			syncStatus={controller.reviewSyncStatus}
			disabled={controller.commitLocked}
			commitPending={controller.commitPending}
			commitStatus={controller.commitStatus}
			commitError={controller.commitError}
			retryCommit={controller.commitRequested &&
			(lifecycle.workflows.commit.lifecycle === 'not-started' ||
				lifecycle.workflows.commit.lifecycle === 'failed' ||
				lifecycle.workflows.commit.lifecycle === 'cancelled') &&
			lifecycle.workflows.commit.retryable
				? {
						pending: controller.commitRetryPending,
						failedStage: lifecycle.workflows.commit.failedStage,
						action: controller.retryCommit
					}
				: undefined}
			onChoicesChange={controller.changeReviewChoices}
			onCommit={controller.commitReview}
		/>
	{:else if controller.view.kind === 'review-data-error'}
		<div class="state error-state" role="alert">
			<strong>Saved review data could not be loaded.</strong>
			<p>Reload this page to try again.</p>
		</div>
	{:else if controller.view.kind === 'review-data-loading'}
		<div class="state" role="status">Loading your saved review choices…</div>
	{:else if lifecycle}
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
			transportError={Boolean(queries.lifecycle.error)}
			retry={{
				label: 'Retry analysis',
				pending: controller.analysisRetryPending,
				action: controller.retryAnalysis
			}}
		/>
		{#if controller.analysisRetryError}
			<p class="error" role="alert">{controller.analysisRetryError}</p>
		{/if}
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
