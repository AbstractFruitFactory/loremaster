<script lang="ts">
	import Icon from '@iconify/svelte'
	import { documentTypes } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { CampaignImportSummary } from '#lib/server/ingestion/types.js'
	import { listCampaignImports } from '../../../routes/campaigns/[campaignId]/data.remote'

	let { campaignId }: { campaignId: string } = $props()

	const campaignImports = $derived(listCampaignImports(campaignId))
	const phaseLabels = {
		analyzing: 'Analyzing sources',
		review: 'Ready for document review',
		committing: 'Updating campaign documents',
		'chronology-analyzing': 'Checking timeline placement',
		'chronology-review': 'Ready for chronology review',
		'chronology-committing': 'Updating chronology',
		'ready-to-finish': 'Ready to finish',
		failed: 'Needs attention'
	} satisfies Record<CampaignImportSummary['phase'], string>

	let retryingImports = $state(false)

	const formatImportDate = (createdAt: string) =>
		new Intl.DateTimeFormat('en', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'UTC'
		}).format(new Date(createdAt))

	const retryCampaignImports = async () => {
		if (retryingImports) return
		retryingImports = true
		try {
			await campaignImports.refresh()
		} catch {
		} finally {
			retryingImports = false
		}
	}
</script>

<svelte:head>
	<title>Campaign workspace | Loremaster</title>
</svelte:head>

<main class="campaign-home">
	<header class="intro">
		<p class="eyebrow">Campaign workspace</p>
		<h2>Your world at a glance</h2>
		<p>
			Move between people, places, sessions, and worldbuilding without losing your place. Ask
			Loremaster from the sidebar whenever you need the wider context.
		</p>
	</header>

	<div class="workspace-actions">
		<a class="import-action" href={`/campaigns/${campaignId}/import`}>
			<Icon icon="lucide:upload" aria-hidden="true" />
			<span>Import campaign notes</span>
		</a>
	</div>

	{#if campaignImports.error || campaignImports.current?.length}
		<section class="active-imports" aria-labelledby="active-imports-heading">
			<div class="section-heading">
				<div>
					<p class="eyebrow">Campaign imports</p>
					<h3 id="active-imports-heading">Continue an active import</h3>
				</div>
				{#if campaignImports.error}
					<button type="button" disabled={retryingImports} onclick={retryCampaignImports}>
						{retryingImports ? 'Retrying…' : 'Try again'}
					</button>
				{/if}
			</div>

			{#if campaignImports.error}
				<p class="imports-error" role="alert">
					Active imports could not be loaded. Completed campaign documents are unaffected.
				</p>
			{:else if campaignImports.current?.length}
				<ul class="import-list">
					{#each campaignImports.current as campaignImport (campaignImport.ingestionId)}
						<li>
							<a
								class="import-card"
								href={`/campaigns/${campaignId}/import/${campaignImport.ingestionId}`}
							>
								<span class={['phase-badge', campaignImport.phase]}>
									{phaseLabels[campaignImport.phase]}
								</span>
								<span class="import-details">
									<strong>Campaign import</strong>
									<time datetime={campaignImport.createdAt}>
										Started {formatImportDate(campaignImport.createdAt)} UTC
									</time>
								</span>
								<span class="continue-import">
									{campaignImport.phase === 'chronology-review' || campaignImport.phase === 'review'
										? 'Review'
										: campaignImport.phase === 'ready-to-finish'
											? 'Finish'
											: 'View status'}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<nav aria-label="Explore campaign lore">
		<ul class="document-list">
			{#each documentTypes as type (type)}
				{@const metadata = documentTypeMetadata[type]}
				<li>
					<a href={`/campaigns/${campaignId}/${type}`}>
						<span class="icon" aria-hidden="true">
							<img src={metadata.iconSrc} alt="" />
						</span>
						<span class="label">
							<strong>{metadata.label}</strong>
							<small>Browse campaign entries</small>
						</span>
						<span class="arrow" aria-hidden="true">
							<Icon icon="lucide:arrow-up-right" />
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</main>

<style>
	.campaign-home {
		box-sizing: border-box;
		width: 100%;
		padding: clamp(1.5rem, 4vw, 3.25rem)
			var(--campaign-inline-padding, clamp(1.25rem, 3vw, 2.75rem)) 0;
		color: #2e281f;
	}

	.intro {
		max-width: 42rem;
		margin-bottom: 1.5rem;
		color: #000;
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		color: #000;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	h2,
	p {
		margin-top: 0;
	}

	h2 {
		margin-bottom: 0.45rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.2rem);
		font-weight: 600;
		line-height: 1;
	}

	.intro > p:last-child {
		margin-bottom: 0;
		color: #000;
		line-height: 1.55;
	}

	.workspace-actions {
		display: flex;
		margin-bottom: 2rem;
	}

	.document-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
		gap: 1.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: flex;
		min-height: 5.2rem;
		align-items: center;
		gap: 0.8rem;
		padding: 0.85rem;
		border: 1.5px solid #39342c;
		border-radius: 2px;
		background: rgb(255 250 239 / 74%);
		box-shadow: 0.2rem 0.2rem 0 rgb(57 52 44 / 88%);
		color: inherit;
		text-decoration: none;
		transition:
			background-color 120ms ease,
			transform 120ms ease,
			box-shadow 120ms ease;
	}

	a:hover {
		background: #fffaf0;
		transform: translate(-1px, -1px);
		box-shadow: 0.28rem 0.28rem 0 #39342c;
	}

	.import-action {
		min-height: auto;
		padding: 0.75rem 1rem;
		background: #f1c278;
		font-weight: 800;
	}

	.import-action:hover {
		background: #fff1d8;
	}

	.import-action > :global(svg) {
		width: 1.15rem;
		height: 1.15rem;
	}

	.active-imports {
		display: grid;
		gap: 0.85rem;
		margin-bottom: 2rem;
		padding: 1rem;
		border: 1.5px solid #6d5838;
		background: rgb(244 232 208 / 72%);
		box-shadow: 0.18rem 0.18rem 0 rgb(57 52 44 / 75%);
	}

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.section-heading h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.45rem;
	}

	.section-heading button {
		padding: 0.5rem 0.7rem;
		border: 1.5px solid #39342c;
		background: #fffaf0;
		color: inherit;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	.section-heading button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.imports-error {
		margin: 0;
		color: #8b382f;
	}

	.import-list {
		display: grid;
		gap: 0.65rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.import-card {
		min-height: auto;
		padding: 0.75rem;
		background: #fffaf0;
		box-shadow: none;
	}

	.phase-badge {
		flex: none;
		padding: 0.28rem 0.5rem;
		border-radius: 999px;
		background: #f1dfbd;
		color: #674b20;
		font-size: 0.7rem;
		font-weight: 800;
	}

	.phase-badge.ready-to-finish {
		background: #dbeae3;
		color: #285044;
	}

	.phase-badge.failed {
		background: #f2d8d4;
		color: #7b3029;
	}

	.import-details {
		display: grid;
		flex: 1;
		gap: 0.1rem;
	}

	.import-details time {
		color: #756b5b;
		font-size: 0.72rem;
	}

	.continue-import {
		flex: none;
		color: #6d542f;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.icon {
		display: grid;
		width: 2.6rem;
		height: 2.6rem;
		flex: 0 0 2.6rem;
		place-items: center;
		border: 1.5px solid #39342c;
		background: #e9bf75;
		color: #39342c;
	}

	.icon img {
		width: 2rem;
		height: 2rem;
		object-fit: contain;
	}

	.arrow :global(svg) {
		width: 1.15rem;
		height: 1.15rem;
	}

	.label {
		display: grid;
		flex: 1;
		line-height: 1.15;
	}

	strong {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 600;
	}

	small {
		margin-top: 0.2rem;
		color: #756b5b;
		font-size: 0.72rem;
	}

	.arrow {
		display: inline-flex;
		color: #886735;
	}

	@media (max-width: 680px) {
		.section-heading,
		.import-card {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
