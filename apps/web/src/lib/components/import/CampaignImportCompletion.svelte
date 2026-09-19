<script lang="ts">
	import Icon from '@iconify/svelte'
	import CampaignImportChronologyReview from './CampaignImportChronologyReview.svelte'
	import { campaignImportChronologyCommitUiState } from '#lib/import/chronology-review.js'
	import type { CampaignImportReviewState } from '#lib/import/review-state.js'
	import {
		campaignImportStageLabels,
		campaignImportStoppedAt
	} from '#lib/import/workflow-status.js'
	import type { CampaignImportLifecycle } from '#lib/server/campaign-import/lifecycle.js'
	import type {
		CampaignImportCommitResult,
		CampaignImportDraft
	} from '#lib/server/ingestion/types.js'

	type PendingAction = {
		pending: boolean
		error?: string
		action: () => void
	}

	type Props = {
		draft: CampaignImportDraft
		choices?: CampaignImportReviewState
		lifecycle: CampaignImportLifecycle
		chronologyRetry: PendingAction
		chronologyCommit: {
			pending: boolean
			error?: string
			action: (selectedChronologyIds: string[]) => void
			retry: () => void
		}
		finish: PendingAction
	}

	let { draft, choices, lifecycle, chronologyRetry, chronologyCommit, finish }: Props = $props()

	const chronologyAnalysis = $derived(lifecycle.workflows['chronology-analysis'])
	const chronologyCommitStatus = $derived(lifecycle.workflows['chronology-commit'])
	const chronologyCommitUi = $derived(
		campaignImportChronologyCommitUiState({
			phase: lifecycle.phase,
			lifecycle: chronologyCommitStatus.lifecycle,
			retryable: chronologyCommitStatus.retryable
		})
	)
	const chronologyAnalysisFailed = $derived(
		!chronologyCommitUi.started &&
			(lifecycle.chronologyDispatchFailed ||
				chronologyAnalysis.lifecycle === 'failed' ||
				chronologyAnalysis.lifecycle === 'cancelled')
	)

	const resultKind = (result: CampaignImportCommitResult['documents'][number]) => {
		const proposal = draft.proposals.find((candidate) => candidate.proposalId === result.proposalId)
		const resolution = proposal ? choices?.resolutions[proposal.proposalId] : undefined
		return resolution?.kind === 'existing' ||
			proposal?.operation === 'update-canon' ||
			proposal?.match.kind === 'exact'
			? 'Updated'
			: 'Created'
	}

	const resultTitle = (result: CampaignImportCommitResult['documents'][number]) =>
		draft.proposals.find((proposal) => proposal.proposalId === result.proposalId)?.title ??
		result.documentId

	const finishReason = $derived.by(() => {
		if (!lifecycle.finishDisabledReason) return ''
		if (lifecycle.finishDisabledReason === 'workflow-active') {
			return 'Finish is available after the active workflow reaches a terminal state.'
		}
		if (lifecycle.finishDisabledReason === 'base-import-incomplete') {
			return 'Finish is available after campaign documents are updated.'
		}
		return 'Finish is available after chronology processing reaches a terminal state.'
	})
</script>

<section class="completion" aria-labelledby="completion-heading">
	<div class="completion-heading">
		<Icon icon="lucide:circle-check-big" aria-hidden="true" />
		<div>
			<p class="eyebrow">Import committed</p>
			<h2 id="completion-heading">
				{lifecycle.baseCompletion?.documents.length
					? 'Campaign documents updated'
					: 'Import finalized with no document changes'}
			</h2>
		</div>
	</div>

	{#if lifecycle.baseCompletion?.documents.length}
		<ul class="result-list">
			{#each lifecycle.baseCompletion.documents as result (result.proposalId)}
				<li>
					<span>{resultKind(result)}</span>
					<strong>{resultTitle(result)}</strong>
					<small>{result.documentType}</small>
				</li>
			{/each}
		</ul>
	{/if}

	{#if chronologyAnalysisFailed}
		<div class="attention" role="alert">
			<div>
				<strong>Chronology analysis needs attention.</strong>
				<p>The campaign document import is already safe and complete.</p>
				{#if chronologyAnalysis.failedStage}
					<p>{campaignImportStoppedAt(chronologyAnalysis.failedStage)}</p>
				{/if}
			</div>
			<div class="actions">
				{#if chronologyAnalysis.retryable}
					<button type="button" disabled={chronologyRetry.pending} onclick={chronologyRetry.action}>
						{chronologyRetry.pending ? 'Restarting…' : 'Retry chronology'}
					</button>
				{/if}
				<button
					type="button"
					class="secondary"
					disabled={finish.pending || !lifecycle.canFinish}
					onclick={finish.action}
				>
					{finish.pending ? 'Finishing…' : 'Finish without chronology'}
				</button>
			</div>
			{#if chronologyRetry.error}<p class="error">{chronologyRetry.error}</p>{/if}
			{#if finish.error}<p class="error">{finish.error}</p>{/if}
			{#if finishReason}<p>{finishReason}</p>{/if}
		</div>
	{:else if !lifecycle.chronologyCompletion && lifecycle.chronologyDraft?.chronology.length}
		<CampaignImportChronologyReview
			draft={lifecycle.chronologyDraft}
			sources={draft.sources}
			commitStarted={chronologyCommitUi.started}
			commitPending={chronologyCommit.pending}
			commitRetryable={chronologyCommitUi.retryable}
			commitFailedStage={chronologyCommitStatus.failedStage}
			commitStatus={chronologyCommitUi.active
				? chronologyCommitStatus.progress
					? campaignImportStageLabels[chronologyCommitStatus.progress.stage]
					: 'Saving selected chronology'
				: undefined}
			commitError={chronologyCommit.error}
			canFinish={lifecycle.canFinish}
			finishPending={finish.pending}
			finishError={finish.error}
			onCommit={chronologyCommit.action}
			onRetryCommit={chronologyCommit.retry}
			onFinish={finish.action}
		/>
	{:else if lifecycle.chronologyCompletion?.kind === 'campaign-import-chronology-no-relations'}
		<div class="chronology-complete" role="status">
			<Icon icon="lucide:git-compare-arrows" aria-hidden="true" />
			<div>
				<strong>No supported chronology relationships were found</strong>
				<p>The imported evidence did not produce any before or during relationships to review.</p>
			</div>
			<button
				type="button"
				disabled={finish.pending || !lifecycle.canFinish}
				onclick={finish.action}
			>
				{finish.pending ? 'Closing…' : 'Close import'}
			</button>
			{#if finish.error}<p class="error">{finish.error}</p>{/if}
		</div>
	{:else if lifecycle.chronologyCompletion?.kind === 'campaign-import-chronology-completion'}
		<div class="chronology-complete" role="status">
			<Icon icon="lucide:git-commit-horizontal" aria-hidden="true" />
			<div>
				{#if lifecycle.chronologyCompletion.updatedDocumentIds.length}
					<strong>Chronology saved</strong>
					<p>
						{lifecycle.chronologyCompletion.updatedDocumentIds.length}
						{lifecycle.chronologyCompletion.updatedDocumentIds.length === 1
							? 'event document was'
							: 'event documents were'}
						updated.
					</p>
				{:else}
					<strong>Chronology review completed without changes</strong>
					<p>No event documents were changed by the approved chronology selection.</p>
				{/if}
			</div>
			<button
				type="button"
				disabled={finish.pending || !lifecycle.canFinish}
				onclick={finish.action}
			>
				{finish.pending ? 'Finishing…' : 'Finish import'}
			</button>
			{#if finish.error}<p class="error">{finish.error}</p>{/if}
		</div>
	{:else if lifecycle.phase === 'ready-to-finish'}
		<div class="ready-to-finish" role="status" aria-live="polite">
			<div>
				<strong>No chronology relationships need review.</strong>
				<p>{finish.pending ? 'Finishing the import…' : 'The import is ready to finish.'}</p>
			</div>
			<button
				type="button"
				disabled={finish.pending || !lifecycle.canFinish}
				onclick={finish.action}
			>
				{finish.pending ? 'Finishing…' : 'Finish import'}
			</button>
			{#if finish.error}<p class="error">{finish.error}</p>{/if}
		</div>
	{:else}
		<div class="chronology-progress" role="status" aria-live="polite">
			<Icon icon="lucide:git-compare-arrows" aria-hidden="true" />
			<div>
				<strong
					>Campaign documents updated — checking how imported events fit into your timeline…</strong
				>
				<p>
					{chronologyAnalysis.progress
						? campaignImportStageLabels[chronologyAnalysis.progress.stage]
						: 'Chronology analysis is queued or running.'}
				</p>
			</div>
		</div>
	{/if}
</section>

<style>
	.completion {
		display: grid;
		gap: 1.15rem;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 94%);
		box-shadow: 0.25rem 0.25rem 0 #171d1a;
	}

	.completion-heading,
	.chronology-progress,
	.chronology-complete,
	.ready-to-finish {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.completion-heading > :global(svg),
	.chronology-complete > :global(svg) {
		width: 2rem;
		height: 2rem;
		color: #31594e;
	}

	.chronology-progress > :global(svg) {
		width: 1.5rem;
		height: 1.5rem;
		color: #89662f;
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

	.result-list {
		display: grid;
		gap: 0.55rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.result-list li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.7rem;
		align-items: center;
		padding: 0.7rem;
		border: 1px solid rgb(134 102 58 / 42%);
		background: #fffaf0;
	}

	.result-list li > span {
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		background: #dbeae3;
		color: #285044;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.result-list small {
		color: #6f604e;
		text-transform: capitalize;
	}

	.attention,
	.chronology-progress,
	.chronology-complete,
	.ready-to-finish {
		padding: 1rem;
		border: 1px solid #a78045;
		background: #f8edd8;
	}

	.attention {
		display: grid;
		gap: 0.75rem;
		border-color: #8d4037;
	}

	.attention > div:first-child {
		display: grid;
		gap: 0.3rem;
	}

	.chronology-progress > div,
	.chronology-complete > div,
	.ready-to-finish > div {
		display: grid;
		flex: 1;
		gap: 0.25rem;
	}

	.chronology-complete,
	.ready-to-finish {
		border-color: #527c6f;
		background: #e2eee8;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
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

	button.secondary {
		background: #fffaf0;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.error {
		color: #9b3d34;
	}

	@media (max-width: 720px) {
		.chronology-complete,
		.ready-to-finish {
			align-items: stretch;
			flex-direction: column;
		}

		.result-list li {
			grid-template-columns: 1fr;
		}
	}
</style>
