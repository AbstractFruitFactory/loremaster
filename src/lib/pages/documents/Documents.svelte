<script lang="ts">
	import type { DocumentType } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { VaultDocumentSummary } from '#lib/server/vault/types.js'

	type Props = {
		selectedType: DocumentType
		documents: readonly VaultDocumentSummary[] | undefined
		isLoading: boolean
		hasLoadError: boolean
	}

	let { selectedType, documents, isLoading, hasLoadError }: Props = $props()

	const heading = $derived(documentTypeMetadata[selectedType].label)
</script>

<svelte:head>
	<title>{heading} | Loremaster</title>
</svelte:head>

<section class="documents-page" aria-labelledby="documents-heading">
	<header class="page-heading">
		<p class="eyebrow">Vault documents</p>
		<h2 id="documents-heading">{heading}</h2>
	</header>

	{#if hasLoadError}
		<div class="state-panel error" role="alert">
			<strong>Unable to load {heading.toLowerCase()}.</strong>
			<span>Try again in a moment.</span>
		</div>
	{:else if isLoading}
		<div class="state-panel" role="status" aria-live="polite">Loading {heading.toLowerCase()}…</div>
	{:else if documents?.length}
		<ul class="document-list">
			{#each documents as document (document.id)}
				<li>
					<h3>{document.title}</h3>
					<p>{document.path}</p>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="state-panel">
			<strong>No {heading.toLowerCase()} yet.</strong>
			<span>Documents in this category will appear here.</span>
		</div>
	{/if}
</section>

<style>
	.documents-page {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		--gold-light: #c8aa75;
		box-sizing: border-box;
		width: min(64rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 6vw, 5rem);
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.page-heading {
		position: relative;
		margin-bottom: 1.25rem;
		padding-bottom: 0.8rem;
		border-bottom: 1px solid rgb(154 120 67 / 38%);
	}

	.page-heading::after {
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

	.eyebrow {
		margin: 0 0 0.25rem;
		color: var(--gold);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	h2,
	h3,
	p {
		margin: 0;
	}

	h2,
	h3 {
		font-family: var(--font-display);
	}

	h2 {
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1;
	}

	.document-list {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.document-list li {
		padding: 1rem 1.15rem;
		border: 1px solid rgb(154 120 67 / 35%);
		background: rgb(250 241 222 / 55%);
		box-shadow: inset 0 0 0 3px rgb(154 120 67 / 4%);
	}

	.document-list h3 {
		overflow-wrap: anywhere;
		font-size: 1.25rem;
		line-height: 1.2;
	}

	.document-list p {
		margin-top: 0.3rem;
		overflow-wrap: anywhere;
		color: var(--ink-soft);
		font-size: 0.85rem;
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
</style>
