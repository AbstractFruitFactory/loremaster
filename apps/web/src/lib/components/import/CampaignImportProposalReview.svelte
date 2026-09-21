<script lang="ts">
	import type { CampaignImportWorkflowLifecycleStage } from '@loremaster/core/workflows/contracts'
	import DocumentReviewCard from './DocumentReviewCard.svelte'
	import ReviewFilters from './ReviewFilters.svelte'
	import {
		buildCampaignImportCommitSelection,
		canSelectProposal,
		proposalMatchesFilters,
		type CampaignImportReviewState,
		type ResolutionChoice,
		type ReviewStatusFilter
	} from '#lib/import/review-state.js'
	import type { CampaignImportReviewSyncStatus } from '#lib/import/review-state-sync.js'
	import { campaignImportStoppedAt } from '#lib/import/workflow-status.js'
	import type { CampaignImportDraft, SessionProposal } from '#lib/server/ingestion/types.js'

	type Props = {
		draft: CampaignImportDraft
		choices: CampaignImportReviewState
		syncStatus: CampaignImportReviewSyncStatus
		disabled: boolean
		commitPending: boolean
		commitStatus?: string
		commitError?: string
		retryCommit?: {
			pending: boolean
			failedStage?: CampaignImportWorkflowLifecycleStage
			action: () => void
		}
		onChoicesChange: (choices: CampaignImportReviewState) => void
		onCommit: () => void
	}

	let {
		draft,
		choices,
		syncStatus,
		disabled,
		commitPending,
		commitStatus,
		commitError,
		retryCommit,
		onChoicesChange,
		onCommit
	}: Props = $props()

	let sourceFilter = $state('all')
	let statusFilter = $state<ReviewStatusFilter>('all')

	const selectedFor = (proposal: SessionProposal) => choices.selected[proposal.proposalId] ?? false
	const resolutionFor = (proposal: SessionProposal) => choices.resolutions[proposal.proposalId]
	const actionableProposals = $derived(
		draft.proposals.filter((proposal) => proposal.operation !== 'mention-only')
	)
	const sourceContext = $derived(
		draft.proposals.filter((proposal) => proposal.operation === 'mention-only')
	)
	const visibleSourceContext = $derived(
		sourceContext.filter((proposal) =>
			proposalMatchesFilters(proposal, false, undefined, sourceFilter, 'all')
		)
	)
	const selection = $derived(buildCampaignImportCommitSelection(actionableProposals, choices))
	const selectedCount = $derived(selection.selectedProposalIds.length)
	const selectedResolutionCount = $derived(selection.resolutions.length)
	const selectionLimitError = $derived(
		selectedCount > 500
			? `Select 500 or fewer proposals before committing. ${selectedCount} are currently selected.`
			: selectedResolutionCount > 500
				? `Resolve and select 500 or fewer identities before committing. ${selectedResolutionCount} selected proposals have identity resolutions.`
				: ''
	)
	const visibleProposals = $derived(
		actionableProposals.filter((proposal) =>
			proposalMatchesFilters(
				proposal,
				selectedFor(proposal),
				resolutionFor(proposal),
				sourceFilter,
				statusFilter
			)
		)
	)

	const changeSelection = (proposal: SessionProposal, selected: boolean) => {
		if (disabled || (selected && !canSelectProposal(proposal, resolutionFor(proposal)))) return
		onChoicesChange({
			selected: { ...choices.selected, [proposal.proposalId]: selected },
			resolutions: { ...choices.resolutions }
		})
	}

	const chooseResolution = (proposal: SessionProposal, resolution: ResolutionChoice) => {
		if (disabled) return
		onChoicesChange({
			selected: { ...choices.selected },
			resolutions: { ...choices.resolutions, [proposal.proposalId]: resolution }
		})
	}

	const syncLabel = $derived.by(() => {
		if (syncStatus.phase === 'pending') return 'Changes waiting to save…'
		if (syncStatus.phase === 'saving') return 'Saving review…'
		if (syncStatus.phase === 'saved') return `Review saved at revision ${syncStatus.revision}.`
		if (syncStatus.phase === 'error')
			return 'Review changes could not be saved. Try committing to retry.'
		if (syncStatus.phase === 'conflict') {
			return 'This review changed elsewhere. Reload before making or committing more changes.'
		}
		return ''
	})
</script>

<section class="review-shell" aria-labelledby="proposals-heading">
	<div class="review-heading">
		<div>
			<p class="eyebrow">Document review</p>
			<h2 id="proposals-heading">
				{actionableProposals.length}
				{actionableProposals.length === 1 ? 'proposal' : 'proposals'} to review
			</h2>
		</div>
		{#if actionableProposals.length}<p>{selectedCount} selected</p>{/if}
	</div>

	<ReviewFilters
		sources={draft.sources}
		sourceId={sourceFilter}
		status={statusFilter}
		showStatus={actionableProposals.length > 0}
		onSourceChange={(value) => (sourceFilter = value)}
		onStatusChange={(value) => (statusFilter = value)}
	/>

	{#if visibleProposals.length}
		<div class="proposal-list">
			{#each visibleProposals as proposal (proposal.proposalId)}
				<DocumentReviewCard
					{proposal}
					sources={draft.sources}
					selected={selectedFor(proposal)}
					resolution={resolutionFor(proposal)}
					{disabled}
					onApprove={() => changeSelection(proposal, true)}
					onReject={() => changeSelection(proposal, false)}
					onResolutionChange={(resolution) => chooseResolution(proposal, resolution)}
				/>
			{/each}
		</div>
	{:else if !actionableProposals.length}
		<div class="empty-state">
			<strong>No campaign changes to approve.</strong>
			<p>
				{sourceContext.length
					? 'This import contains source context only. These details do not create or update campaign documents.'
					: 'This import did not produce any document proposals.'}
			</p>
		</div>
	{:else}
		<div class="empty-state">
			<strong>No proposals match these filters.</strong>
			<p>Choose a different source or status.</p>
		</div>
	{/if}

	{#if sourceContext.length}
		<details class="source-context">
			<summary>Source context ({visibleSourceContext.length})</summary>
			<p>
				Reference details from your sources. No approval is needed, and these details will not
				change campaign documents.
			</p>
			<div class="proposal-list">
				{#each visibleSourceContext as proposal (proposal.proposalId)}
					<DocumentReviewCard
						{proposal}
						sources={draft.sources}
						selected={false}
						{disabled}
						onApprove={() => changeSelection(proposal, true)}
						onReject={() => changeSelection(proposal, false)}
						onResolutionChange={(resolution) => chooseResolution(proposal, resolution)}
					/>
				{:else}
					<p>No source context matches this source filter.</p>
				{/each}
			</div>
		</details>
	{/if}

	{#if draft.warnings.length}
		<details class="warnings">
			<summary>
				{draft.warnings.length} analysis {draft.warnings.length === 1 ? 'warning' : 'warnings'}
			</summary>
			<ul>
				{#each draft.warnings as warning, index (`${index}:${warning}`)}
					<li>{warning}</li>
				{/each}
			</ul>
		</details>
	{/if}

	<footer class="commit-panel">
		<div>
			<strong>
				{selectedCount
					? `${selectedCount} ${selectedCount === 1 ? 'proposal' : 'proposals'} will be committed`
					: actionableProposals.length
						? 'No proposals selected'
						: 'Ready to finalize without changes'}
			</strong>
			<p>
				{selectedCount
					? 'Not-selected proposals will not change campaign canon.'
					: 'You can finalize this import without changing campaign documents.'}
			</p>
			{#if syncLabel}
				<p
					class={[(syncStatus.phase === 'error' || syncStatus.phase === 'conflict') && 'error']}
					role={syncStatus.phase === 'error' || syncStatus.phase === 'conflict'
						? 'alert'
						: 'status'}
					aria-live="polite"
				>
					{syncLabel}
				</p>
			{/if}
			{#if selectionLimitError}<p class="error" role="alert">{selectionLimitError}</p>{/if}
			{#if commitError}<p class="error" role="alert">{commitError}</p>{/if}
			{#if commitStatus}<p role="status" aria-live="polite">{commitStatus}</p>{/if}
			{#if retryCommit}
				<div class="retry-row" role="alert">
					<span>The campaign commit needs to be restarted.</span>
					{#if retryCommit.failedStage}
						<span>{campaignImportStoppedAt(retryCommit.failedStage)}</span>
					{/if}
					<button type="button" disabled={retryCommit.pending} onclick={retryCommit.action}>
						{retryCommit.pending ? 'Restarting…' : 'Retry commit'}
					</button>
				</div>
			{/if}
		</div>
		<button type="button" disabled={disabled || Boolean(selectionLimitError)} onclick={onCommit}>
			{commitPending
				? 'Saving review…'
				: selectedCount
					? 'Commit selected proposals'
					: 'Finalize with no changes'}
		</button>
	</footer>
</section>

<style>
	.review-shell {
		display: grid;
		gap: 1.15rem;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 94%);
		box-shadow: 0.25rem 0.25rem 0 #171d1a;
	}

	.review-heading,
	.commit-panel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-family: var(--font-display);
	}

	.eyebrow {
		color: #86652e;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.commit-panel p {
		color: #6f604e;
	}

	.proposal-list {
		display: grid;
		gap: 1rem;
	}

	.empty-state {
		padding: 1.25rem;
		border: 1px dashed #a88b61;
		background: rgb(245 234 213 / 58%);
		text-align: center;
	}

	.source-context {
		padding: 1rem;
		border: 1px solid rgb(143 112 67 / 45%);
	}

	.source-context summary {
		font-weight: 800;
		cursor: pointer;
	}

	.source-context > p {
		margin: 0.75rem 0;
		color: #6f604e;
	}

	.warnings {
		padding: 0.9rem;
		border: 1px solid #b58b4d;
		background: #fbf0d8;
	}

	.warnings summary {
		font-weight: 800;
		cursor: pointer;
	}

	.warnings ul {
		margin: 0.6rem 0 0;
		padding-left: 1.25rem;
	}

	.commit-panel {
		padding: 1rem;
		border: 1px solid #8f7147;
		background: #f4e8d0;
	}

	.commit-panel > div {
		display: grid;
		gap: 0.35rem;
	}

	button {
		padding: 0.6rem 0.85rem;
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: #f1c278;
		box-shadow: 0.15rem 0.15rem 0 #3d382f;
		color: #282016;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	button:focus-visible {
		outline: 2px solid #c8aa75;
		outline-offset: 2px;
	}

	.retry-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: center;
	}

	.error {
		color: #9b3d34 !important;
	}

	@media (max-width: 720px) {
		.review-heading,
		.commit-panel {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
