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

<section class="documents-page" aria-label={heading}>
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
								<span class="card-icon-corner top-left"></span>
								<span class="card-icon-corner top-right"></span>
								<span class="card-icon-corner bottom-left"></span>
								<span class="card-icon-corner bottom-right"></span>
								<img src={documentTypeMetadata[selectedType].iconSrc} alt="" />
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
		padding: clamp(1.5rem, 3vw, 2.75rem)
			var(--campaign-inline-padding, clamp(1.25rem, 3vw, 2.75rem)) 2rem;
		color: var(--ink);
		font-family: var(--font-sans);
	}

	h3,
	p {
		margin: 0;
	}

	h3 {
		font-family: var(--font-display);
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
		height: 11rem;
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
		display: -webkit-box;
		margin-top: auto;
		overflow-wrap: anywhere;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 1.25rem;
		line-height: 1.2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.document-list p {
		display: -webkit-box;
		margin-top: 0.3rem;
		overflow-wrap: anywhere;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink-soft);
		font-size: 0.85rem;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.card-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.card-icon {
		position: relative;
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 2px solid #282016;
		background: #fffaf0;
		color: #3d382f;
	}

	.card-icon img {
		width: 2rem;
		height: 2rem;
		object-fit: contain;
	}

	.card-icon-corner {
		position: absolute;
		z-index: 1;
		width: 0.4rem;
		height: 0.4rem;
		border: 1.5px solid #282016;
		border-radius: 1px;
		background: #65cfc9;
		transform: rotate(45deg);
	}

	.card-icon-corner.top-left {
		top: -0.25rem;
		left: -0.25rem;
	}

	.card-icon-corner.top-right {
		top: -0.25rem;
		right: -0.25rem;
	}

	.card-icon-corner.bottom-left {
		bottom: -0.25rem;
		left: -0.25rem;
	}

	.card-icon-corner.bottom-right {
		right: -0.25rem;
		bottom: -0.25rem;
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
