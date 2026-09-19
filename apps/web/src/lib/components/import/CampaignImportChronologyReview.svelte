<script lang="ts">
	import { untrack } from 'svelte'
	import EvidenceSummary from './EvidenceSummary.svelte'
	import {
		groupCampaignImportChronology,
		initialCampaignImportChronologySelections,
		selectedCampaignImportChronologyIds
	} from '#lib/import/chronology-review.js'
	import { campaignImportStoppedAt } from '#lib/import/workflow-status.js'
	import type { CampaignImportWorkflowLifecycleStage } from '@loremaster/core/workflows/contracts'
	import type {
		CampaignImportChronologyDraft,
		CampaignImportSource
	} from '#lib/server/ingestion/types.js'

	type Props = {
		draft: CampaignImportChronologyDraft
		sources: readonly CampaignImportSource[]
		commitStarted: boolean
		commitPending: boolean
		commitRetryable: boolean
		commitFailedStage?: CampaignImportWorkflowLifecycleStage
		commitStatus?: string
		commitError?: string
		canFinish: boolean
		finishPending: boolean
		finishError?: string
		onCommit: (selectedChronologyIds: string[]) => void
		onRetryCommit: () => void
		onFinish: () => void
	}

	let {
		draft,
		sources,
		commitStarted,
		commitPending,
		commitRetryable,
		commitFailedStage,
		commitStatus,
		commitError,
		canFinish,
		finishPending,
		finishError,
		onCommit,
		onRetryCommit,
		onFinish
	}: Props = $props()

	let selections = $state(
		untrack(() => initialCampaignImportChronologySelections(draft.chronology))
	)
	let approvalConfirmed = $state(false)

	const groups = $derived(groupCampaignImportChronology(draft.chronology))
	const selectedIds = $derived(selectedCampaignImportChronologyIds(draft.chronology, selections))
	const overSelectionLimit = $derived(selectedIds.length > 500)

	const changeSelection = (chronologyId: string, selected: boolean) => {
		if (commitStarted) return
		selections[chronologyId] = selected
		approvalConfirmed = false
	}

	const relationLabel = (relation: 'before' | 'during') =>
		relation === 'before' ? 'happens before' : 'takes place during'
</script>

<section class="chronology-review" aria-labelledby="chronology-heading">
	<header>
		<p class="eyebrow">Optional chronology</p>
		<h3 id="chronology-heading">Before and during relationships</h3>
		<p>
			Review each affected event or period, then explicitly approve only the relationships that
			should be written.
		</p>
	</header>

	<fieldset disabled={commitStarted}>
		<legend>Proposed relationships</legend>
		<div class="relationship-groups">
			{#each groups as group (group.affected.eventId)}
				<section class="relationship-group" aria-labelledby={`event-${group.affected.eventId}`}>
					<div class="group-heading">
						<span>Affected event or period</span>
						<h4 id={`event-${group.affected.eventId}`}>{group.affected.title}</h4>
					</div>
					<div class="relationship-list">
						{#each group.relationships as relationship (relationship.chronologyId)}
							<article
								class={['relationship', selections[relationship.chronologyId] && 'selected']}
							>
								<label>
									<input
										type="checkbox"
										checked={selections[relationship.chronologyId]}
										onchange={(event) =>
											changeSelection(relationship.chronologyId, event.currentTarget.checked)}
									/>
									<span>
										<strong>
											{relationship.source.title}
											<em>{relationLabel(relationship.relation)}</em>
											{relationship.target.title}
										</strong>
										<small>
											{relationship.certainty === 'explicit' ? 'Explicit evidence' : 'Inferred'}
										</small>
									</span>
								</label>
								<p>{relationship.reason}</p>
								<EvidenceSummary evidence={relationship.evidence} {sources} />
							</article>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</fieldset>

	{#if draft.chronologyCoverage.length}
		<section class="coverage" aria-labelledby="coverage-heading">
			<h4 id="coverage-heading">Coverage</h4>
			<ul>
				{#each draft.chronologyCoverage as coverage (coverage.event.eventId)}
					<li>
						<strong>{coverage.event.title}</strong>
						<span>{coverage.status.replaceAll('-', ' ')}</span>
						<p>{coverage.reason}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if draft.warnings.length}
		<div class="warnings" role="alert">
			<strong>Chronology warnings</strong>
			<ul>
				{#each draft.warnings as warning, index (`${index}:${warning}`)}
					<li>{warning}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="approval">
		<label>
			<input
				type="checkbox"
				bind:checked={approvalConfirmed}
				disabled={commitStarted || overSelectionLimit}
			/>
			<span>I approve these {selectedIds.length} selected chronology relationships.</span>
		</label>
		{#if overSelectionLimit}
			<p class="error" role="alert">
				Select 500 or fewer chronology relationships before committing. {selectedIds.length} are currently
				selected.
			</p>
		{/if}
	</div>

	<div class="actions">
		{#if commitRetryable}
			<button type="button" disabled={commitPending} onclick={onRetryCommit}>
				{commitPending ? 'Restarting…' : 'Retry chronology save'}
			</button>
		{:else if !commitStarted}
			<button
				type="button"
				disabled={commitStarted || !approvalConfirmed || overSelectionLimit}
				onclick={() => onCommit(selectedIds)}
			>
				{commitPending ? 'Starting save…' : 'Commit selected chronology'}
			</button>
			<button
				type="button"
				class="secondary"
				disabled={finishPending || !canFinish}
				onclick={onFinish}
			>
				{finishPending ? 'Finishing…' : 'Skip chronology'}
			</button>
		{/if}
	</div>

	{#if commitStarted}
		<p class="commit-lock-message" role="status">
			{commitRetryable
				? 'Completion requires retrying the chronology save.'
				: commitStatus
					? 'Approval controls are locked while chronology is saved.'
					: 'Approval controls are locked until chronology completion is recorded.'}
		</p>
	{/if}
	{#if commitFailedStage}
		<p class="failed-stage">{campaignImportStoppedAt(commitFailedStage)}</p>
	{/if}
	{#if commitStatus}<p role="status" aria-live="polite">{commitStatus}</p>{/if}
	{#if commitError}<p class="error" role="alert">{commitError}</p>{/if}
	{#if finishError}<p class="error" role="alert">{finishError}</p>{/if}
</section>

<style>
	.chronology-review {
		display: grid;
		gap: 1.15rem;
		padding: 1rem;
		border: 1px solid #8d7149;
		background: #f8edd8;
	}

	header {
		display: grid;
		gap: 0.25rem;
	}

	h3,
	h4,
	p {
		margin: 0;
	}

	h3,
	h4 {
		font-family: var(--font-display);
	}

	.eyebrow,
	.group-heading span {
		color: #86652e;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	fieldset {
		margin: 0;
		padding: 0.9rem;
		border: 1px solid rgb(133 102 61 / 48%);
	}

	legend {
		padding: 0 0.3rem;
		font-weight: 800;
	}

	.relationship-groups,
	.relationship-list,
	.relationship-group {
		display: grid;
		gap: 0.75rem;
	}

	.relationship-group + .relationship-group {
		padding-top: 0.9rem;
		border-top: 1px solid rgb(133 102 61 / 38%);
	}

	.group-heading {
		display: grid;
		gap: 0.15rem;
	}

	.relationship {
		display: grid;
		gap: 0.7rem;
		padding: 0.8rem;
		border: 1px solid rgb(139 109 67 / 45%);
		background: #fffaf0;
	}

	.relationship.selected {
		border-color: #31594e;
		box-shadow: 0.14rem 0.14rem 0 #31594e;
	}

	.relationship > label {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.65rem;
		cursor: pointer;
	}

	.relationship input,
	.approval input {
		margin-top: 0.25rem;
		accent-color: #31594e;
	}

	.relationship label span,
	.relationship small {
		display: grid;
	}

	.relationship em {
		margin: 0 0.25rem;
		color: #8a642b;
		font-style: normal;
	}

	.relationship small,
	.relationship > p,
	.coverage p {
		color: #6f604e;
	}

	.coverage {
		display: grid;
		gap: 0.55rem;
	}

	.coverage ul {
		display: grid;
		gap: 0.55rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.coverage li {
		display: grid;
		grid-template-columns: 1fr auto;
		padding: 0.7rem;
		border: 1px solid rgb(133 102 61 / 42%);
		background: #fffaf0;
	}

	.coverage li span {
		color: #7a5c2e;
		font-size: 0.75rem;
		font-weight: 800;
		text-transform: capitalize;
	}

	.coverage li p {
		grid-column: 1 / -1;
	}

	.warnings,
	.approval {
		padding: 0.9rem;
		border: 1px solid #b58b4d;
		background: #fbf0d8;
	}

	.warnings ul {
		margin: 0.6rem 0 0;
		padding-left: 1.25rem;
	}

	.approval {
		display: grid;
		gap: 0.55rem;
	}

	.approval label {
		display: flex;
		gap: 0.55rem;
		font-weight: 800;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: center;
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

	.failed-stage {
		color: #8b382f;
	}
</style>
