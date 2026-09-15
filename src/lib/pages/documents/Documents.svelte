<script lang="ts">
	import Icon from '@iconify/svelte'
	import type { DocumentType } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { VaultDocumentSummary } from '#lib/server/vault/types.js'

	type Props = {
		campaignId: string
		selectedType: DocumentType
		documents: readonly VaultDocumentSummary[] | undefined
		isLoading: boolean
		hasLoadError: boolean
	}

	let { campaignId, selectedType, documents, isLoading, hasLoadError }: Props = $props()

	const heading = $derived(documentTypeMetadata[selectedType].label)
</script>

<svelte:head>
	<title>{heading} | Loremaster</title>
</svelte:head>

<section class="documents-page" aria-labelledby="documents-heading">
	<header class="page-heading">
		<div>
			<p class="eyebrow">Campaign lore</p>
			<h2 id="documents-heading">{heading}</h2>
		</div>
		{#if selectedType === 'session'}
			<a class="ingest-link" href={`/campaigns/${campaignId}/session/ingest`}>Ingest session</a>
		{/if}
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
					<a
						class="document-card"
						href={`/campaigns/${campaignId}/${document.type}/${document.id}`}
					>
						<div class="card-heading">
							<span class="card-icon" aria-hidden="true">
								<Icon icon={documentTypeMetadata[selectedType].icon} />
							</span>
							<span class="card-arrow" aria-hidden="true">
								<Icon icon="lucide:arrow-up-right" />
							</span>
						</div>
						<h3>{document.title}</h3>
						{#if document.summary}
							<p>{document.summary}</p>
						{/if}
					</a>
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
		width: 100%;
		padding: clamp(1.5rem, 3vw, 2.75rem) 0 0;
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.page-heading {
		position: relative;
		display: flex;
		gap: 1rem;
		align-items: end;
		justify-content: space-between;
		margin-bottom: 1.5rem;
		color: #f5ead6;
	}

	.ingest-link {
		padding: 0.55rem 0.75rem;
		border: 1.5px solid #353129;
		border-radius: 2px;
		background: #f1c278;
		box-shadow: 0.16rem 0.16rem 0 #353129;
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.ingest-link:hover {
		background: rgb(250 241 222 / 95%);
	}

	.ingest-link:focus-visible {
		outline: 2px solid var(--gold-light);
		outline-offset: 3px;
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
		grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
		gap: 1.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.document-list li {
		padding: 0;
		border: none;
		background: none;
		box-shadow: none;
	}

	.document-card {
		display: flex;
		min-height: 11rem;
		padding: 1.05rem 1.15rem 1.15rem;
		flex-direction: column;
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 76%);
		box-shadow: 0.2rem 0.2rem 0 rgb(61 56 47 / 88%);
		color: inherit;
		text-decoration: none;
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease,
			transform 150ms ease;
	}

	.document-card:hover {
		background: #fffaf0;
		box-shadow: 0.3rem 0.3rem 0 #3d382f;
		transform: translate(-1px, -1px);
	}

	.document-card:focus-visible {
		border-color: #9a7843;
		outline: 2px solid #c8aa75;
		outline-offset: 3px;
	}

	.document-list h3 {
		margin-top: auto;
		overflow-wrap: anywhere;
		font-size: 1.25rem;
		line-height: 1.2;
	}

	.document-list p {
		display: -webkit-box;
		margin-top: 0.3rem;
		overflow-wrap: anywhere;
		overflow: hidden;
		color: var(--ink-soft);
		font-size: 0.85rem;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
	}

	.card-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.card-icon {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border: 1.5px solid #3d382f;
		background: #e8bc71;
		color: #3d382f;
	}

	.card-icon :global(svg),
	.card-arrow :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.card-arrow {
		display: inline-flex;
		color: #8b6b37;
	}

	.state-panel {
		display: grid;
		gap: 0.3rem;
		padding: 1.6rem;
		border: 1px solid rgb(194 155 91 / 58%);
		border-radius: 0.75rem;
		background: linear-gradient(145deg, #fff9ed, #f3e6d2);
		box-shadow: 0 0.8rem 1.8rem rgb(9 18 14 / 24%);
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
