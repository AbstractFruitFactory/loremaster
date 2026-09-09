<script lang="ts">
	import LoreContent from '#lib/components/lore-content/LoreContent.svelte'
	import type { DocumentType } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { VaultDocument } from '#lib/server/vault/types.js'

	type Props = {
		selectedType: DocumentType
		document: VaultDocument | undefined
		isLoading: boolean
		hasLoadError: boolean
		typeMismatch: boolean
		backHref: string
		historyHref: string
	}

	let {
		selectedType,
		document,
		isLoading,
		hasLoadError,
		typeMismatch,
		backHref,
		historyHref
	}: Props = $props()

	const category = $derived(documentTypeMetadata[selectedType])
</script>

<svelte:head>
	<title>{document?.title ?? category.label} | Loremaster</title>
</svelte:head>

<section class="document-detail" aria-labelledby="document-heading">
	<a class="back-link" href={backHref}>← Back to {category.label}</a>

	{#if hasLoadError || typeMismatch}
		<div class="state-panel error" role="alert">
			<strong>Unable to load this entry.</strong>
			<span>It may have been removed or moved.</span>
		</div>
	{:else if isLoading}
		<div class="state-panel" role="status" aria-live="polite">Loading entry…</div>
	{:else if document}
		<header class="document-header">
			<div class="title-row">
				<h2 id="document-heading">{document.title}</h2>
				<span class="category-badge">{category.label}</span>
				<a class="history-link" href={historyHref}>View history</a>
			</div>

			{#if document.aliases?.length}
				<p class="aliases">
					Also known as:
					{document.aliases.join(', ')}
				</p>
			{/if}

			{#if document.summary}
				<p class="summary">{document.summary}</p>
			{/if}
		</header>

		<div class="document-body">
			<LoreContent content={document.content} />
		</div>
	{/if}
</section>

<style>
	.document-detail {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		box-sizing: border-box;
		width: min(64rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 6vw, 5rem);
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.back-link {
		display: inline-block;
		margin-bottom: 1.25rem;
		color: var(--gold);
		font-size: 0.88rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	.document-header {
		position: relative;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgb(154 120 67 / 38%);
	}

	.document-header::after {
		position: absolute;
		bottom: -3px;
		left: 2.5rem;
		width: 5px;
		height: 5px;
		border: 1px solid var(--gold);
		background: #eee0c6;
		content: '';
		transform: rotate(45deg);
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1;
	}

	.category-badge {
		padding: 0.28rem 0.65rem;
		border: 1px solid rgb(154 120 67 / 45%);
		border-radius: var(--border-radius-full);
		background: rgb(244 230 199 / 72%);
		color: var(--gold);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.history-link {
		margin-left: auto;
		color: var(--gold);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.history-link:hover {
		text-decoration: underline;
	}

	.history-link:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 3px;
	}

	.aliases,
	.summary {
		margin-top: 0.75rem;
		color: var(--ink-soft);
	}

	.summary {
		max-width: 44rem;
		font-size: 1.05rem;
		line-height: 1.55;
	}

	.document-body {
		padding-top: 0.25rem;
	}

	.state-panel {
		display: grid;
		gap: 0.3rem;
		padding: 1.6rem;
		border: 1px dashed rgb(154 120 67 / 48%);
		background: rgb(250 240 219 / 42%);
		color: var(--ink-soft);
		text-align: center;
	}

	.state-panel strong {
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 600;
	}

	.state-panel.error,
	.state-panel.error strong {
		color: #8b2f27;
	}

	@media (max-width: 34rem) {
		.history-link {
			width: 100%;
			margin-left: 0;
		}
	}
</style>
