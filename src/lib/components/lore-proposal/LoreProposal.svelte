<script module lang="ts">
	import type { DocumentType } from '#lib/document.js'

	export type LoreProposalDraft = {
		title: string
		category: DocumentType
		content: string
	}

	export type LoreProposalCategoryOption = {
		value: DocumentType
		label: string
	}
</script>

<script lang="ts">
	import Button from '#lib/components/button/Button.svelte'
	import TextInput from '#lib/components/text-input/TextInput.svelte'
	import Textarea from '#lib/components/textarea/Textarea.svelte'
	import { untrack } from 'svelte'

	const proposalId = $props.id()
	const proposalHeadingId = `${proposalId}-heading`

	let {
		proposal,
		categoryOptions,
		isSubmitting = false,
		error = '',
		onsave,
		oncancel
	}: {
		proposal: LoreProposalDraft
		categoryOptions: readonly LoreProposalCategoryOption[]
		isSubmitting?: boolean
		error?: string
		onsave: (draft: LoreProposalDraft) => void | Promise<void>
		oncancel: () => void
	} = $props()

	let draft = $state<LoreProposalDraft>(
		untrack(() => ({
			title: proposal.title,
			category: proposal.category,
			content: proposal.content
		}))
	)

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault()
		onsave({
			title: draft.title,
			category: draft.category,
			content: draft.content
		})
	}
</script>

<form class="proposal" onsubmit={handleSubmit} aria-labelledby={proposalHeadingId}>
	<div class="proposal-heading">
		<div>
			<p class="eyebrow">Review before adding</p>
			<h3 id={proposalHeadingId}>Lore proposal</h3>
		</div>
		<span>Draft</span>
	</div>

	<div class="proposal-fields">
		<label>
			Title
			<TextInput
				bind:value={draft.title}
				required
				maxlength={200}
				autocomplete="off"
				placeholder="Name this lore entry"
				disabled={isSubmitting}
				--text-input-padding="0.62rem 0.72rem"
				--text-input-border="1px solid #aa966f"
				--text-input-radius="var(--border-radius-md)"
				--text-input-background="rgb(255 253 247 / 92%)"
				--text-input-color="#30291f"
				--text-input-disabled-background="rgb(233 226 211 / 75%)"
			/>
		</label>
		<label>
			Category
			<select bind:value={draft.category} required disabled={isSubmitting}>
				{#each categoryOptions as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</label>
	</div>

	<label>
		Content
		<Textarea
			bind:value={draft.content}
			required
			rows={6}
			disabled={isSubmitting}
			--textarea-padding="0.62rem 0.72rem"
			--textarea-border="1px solid #aa966f"
			--textarea-radius="var(--border-radius-md)"
			--textarea-background="rgb(255 253 247 / 92%)"
			--textarea-color="#30291f"
			--textarea-disabled-background="rgb(233 226 211 / 75%)"
		/>
	</label>

	{#if error}
		<p class="error proposal-error" role="alert">{error}</p>
	{/if}

	<div class="proposal-actions">
		<Button type="submit" disabled={isSubmitting}>
			{isSubmitting ? 'Adding…' : 'Add to lore'}
		</Button>
		<Button type="button" variant="secondary" onclick={oncancel} disabled={isSubmitting}>
			Cancel
		</Button>
	</div>
</form>

<style>
	h3,
	p {
		margin-top: 0;
	}

	h3 {
		margin-bottom: 0;
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.15;
	}

	.proposal {
		display: grid;
		gap: var(--spacing-md);
		margin: 0;
		padding-top: 0.85rem;
		border-top: 1px solid rgb(142 114 69 / 28%);
	}

	.proposal-heading {
		display: flex;
		justify-content: space-between;
		gap: var(--spacing-md);
		align-items: flex-start;
	}

	.eyebrow {
		margin-bottom: 0.2rem;
		color: #786342;
		font-size: 0.67rem;
		font-weight: 600;
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}

	.proposal-heading > span {
		flex: none;
		padding: 0.2rem 0.55rem;
		border-radius: var(--border-radius-full);
		background: #e1cfaa;
		color: #654d26;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.proposal-fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(9rem, 0.35fr);
		gap: var(--spacing-md);
	}

	label {
		display: grid;
		gap: 0.32rem;
		color: #4e422f;
		font-size: 0.84rem;
		font-weight: 600;
	}

	select {
		width: 100%;
		padding: 0.62rem 0.72rem;
		border: 1px solid #aa966f;
		border-radius: var(--border-radius-md);
		background: rgb(255 253 247 / 92%);
		color: #30291f;
	}

	select:disabled {
		background: rgb(233 226 211 / 75%);
		cursor: not-allowed;
	}

	.error {
		color: #842f25;
	}

	.proposal-error {
		margin-bottom: 0;
		font-weight: 600;
	}

	.proposal-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	@media (max-width: 44rem) {
		.proposal-fields {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 30rem) {
		.proposal-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.proposal-actions :global(button.button) {
			width: 100%;
		}
	}
</style>
