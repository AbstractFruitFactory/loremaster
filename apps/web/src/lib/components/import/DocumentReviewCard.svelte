<script lang="ts">
	import Icon from '@iconify/svelte'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { CampaignImportSource, SessionProposal } from '#lib/server/ingestion/types.js'
	import {
		canSelectProposal,
		needsIdentityResolution,
		sameTypeCandidates,
		type ResolutionChoice
	} from '#lib/import/review-state.js'
	import EvidenceSummary from './EvidenceSummary.svelte'

	type Props = {
		proposal: SessionProposal
		sources: readonly CampaignImportSource[]
		selected: boolean
		resolution?: ResolutionChoice
		disabled?: boolean
		onApprove: () => void
		onReject: () => void
		onResolutionChange: (resolution: ResolutionChoice) => void
	}

	let {
		proposal,
		sources,
		selected,
		resolution,
		disabled = false,
		onApprove,
		onReject,
		onResolutionChange
	}: Props = $props()

	const isSourceContext = $derived(proposal.operation === 'mention-only')
	const candidates = $derived(sameTypeCandidates(proposal))
	const needsResolution = $derived(needsIdentityResolution(proposal))
	const decisionLabel = $derived(selected ? 'Selected' : 'Not selected')
	const typeLabel = $derived(documentTypeMetadata[proposal.documentType].label)
	const canApprove = $derived(canSelectProposal(proposal, resolution))

	const operationLabel = (operation: SessionProposal['operation']) => {
		if (operation === 'update-canon') return 'Update'
		if (operation === 'create-event' || operation === 'create-entity') return 'Create'
		if (operation === 'record-only') return 'Record only'
		return 'Mention only'
	}
</script>

<article
	class={[
		'review-card',
		isSourceContext && 'context-card',
		!isSourceContext && selected && 'selected'
	]}
>
	<header>
		<div>
			<p class="card-kicker">
				<span>{typeLabel}</span>
				<span aria-hidden="true">·</span>
				<span>{isSourceContext ? 'Source context' : operationLabel(proposal.operation)}</span>
				{#if proposal.groupId && !isSourceContext}
					<span aria-hidden="true">·</span>
					<span>Grouped proposal</span>
				{/if}
			</p>
			<h3>{proposal.title}</h3>
		</div>
		{#if !isSourceContext}
			<span class="decision-badge">{decisionLabel}</span>
		{/if}
	</header>

	<div class="proposal-content">{proposal.content}</div>

	<EvidenceSummary evidence={proposal.evidence} {sources} />

	{#if isSourceContext}
		<p class="source-context">
			This detail is kept as source context. It does not create or update a campaign document.
		</p>
	{/if}

	{#if !isSourceContext && needsResolution}
		<fieldset class="identity-options" {disabled}>
			<legend>Which document does this describe?</legend>
			<p>Choose an identity before committing this proposal.</p>
			<div class="option-list">
				{#each candidates as candidate (candidate.documentId)}
					<label>
						<input
							type="radio"
							name={`identity-${proposal.proposalId}`}
							checked={resolution?.kind === 'existing' &&
								resolution.documentId === candidate.documentId}
							onchange={() =>
								onResolutionChange({
									kind: 'existing',
									documentId: candidate.documentId
								})}
						/>
						<span>
							<strong>{candidate.title}</strong>
							<small>Update this existing {typeLabel.toLocaleLowerCase()} document.</small>
						</span>
					</label>
				{/each}

				{#if proposal.canCreate}
					<label>
						<input
							type="radio"
							name={`identity-${proposal.proposalId}`}
							checked={resolution?.kind === 'create'}
							onchange={() => onResolutionChange({ kind: 'create' })}
						/>
						<span>
							<strong>None of these — create as a new document</strong>
							<small
								>Create “{proposal.title}” as a new {typeLabel.toLocaleLowerCase()} document.</small
							>
						</span>
					</label>
				{/if}
			</div>
		</fieldset>
	{/if}

	{#if !isSourceContext}
		<footer class="review-actions">
			<button type="button" class="reject" aria-pressed={!selected} {disabled} onclick={onReject}>
				<Icon icon="lucide:x" aria-hidden="true" />
				Reject
			</button>
			<button
				type="button"
				class="approve"
				aria-pressed={selected}
				disabled={disabled || !canApprove}
				onclick={onApprove}
			>
				<Icon icon="lucide:check" aria-hidden="true" />
				Approve
			</button>
		</footer>
	{/if}
</article>

<style>
	.review-card {
		display: grid;
		gap: 1.1rem;
		padding: clamp(1rem, 2vw, 1.35rem);
		border: 1.5px solid #4a4338;
		border-radius: 2px;
		background: rgb(255 250 239 / 94%);
		box-shadow: 0.2rem 0.2rem 0 rgb(35 31 25 / 85%);
	}

	.review-card.context-card {
		border-color: rgb(143 112 67 / 45%);
		box-shadow: none;
	}

	.review-card.selected {
		border-color: #31594e;
		box-shadow: 0.2rem 0.2rem 0 #31594e;
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	h3,
	p {
		margin: 0;
	}

	h3 {
		margin-top: 0.2rem;
		font-family: var(--font-display);
		font-size: clamp(1.35rem, 3vw, 1.75rem);
	}

	.card-kicker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		color: #7a6038;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.decision-badge {
		flex: none;
		padding: 0.3rem 0.55rem;
		border-radius: 999px;
		background: #dbeae3;
		color: #2b5549;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.proposal-content {
		white-space: pre-wrap;
		line-height: 1.55;
	}

	.source-context {
		padding: 0.7rem;
		background: #f1e4c8;
		color: #6f542a;
		font-size: 0.82rem;
	}

	.identity-options {
		margin: 0;
		padding: 1rem;
		border: 1px solid rgb(143 112 67 / 55%);
		background: rgb(244 233 211 / 55%);
	}

	.identity-options legend {
		padding: 0 0.3rem;
		font-weight: 800;
	}

	.identity-options > p {
		margin-bottom: 0.7rem;
		color: #6f604e;
		font-size: 0.82rem;
	}

	.option-list {
		display: grid;
		gap: 0.55rem;
	}

	.option-list label {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.65rem;
		border: 1px solid rgb(139 109 67 / 45%);
		background: #fffaf0;
		cursor: pointer;
	}

	.option-list input {
		margin-top: 0.2rem;
		accent-color: #31594e;
	}

	.option-list span,
	.option-list small {
		display: grid;
	}

	.option-list small {
		margin-top: 0.15rem;
		color: #6f604e;
	}

	.review-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.review-actions button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.55rem 0.8rem;
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: #fffaf0;
		color: #30291f;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	.review-actions .approve[aria-pressed='true'] {
		background: #31594e;
		color: #fffaf0;
	}

	.review-actions .reject[aria-pressed='true'] {
		background: #8b382f;
		color: #fffaf0;
	}

	.review-actions button:focus-visible,
	.option-list input:focus-visible {
		outline: 2px solid #c8aa75;
		outline-offset: 2px;
	}

	.review-actions button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
</style>
