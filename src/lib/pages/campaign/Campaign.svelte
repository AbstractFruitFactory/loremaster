<script lang="ts">
	import Icon from '@iconify/svelte'
	import { documentTypes } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'

	let { campaignId }: { campaignId: string } = $props()
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
			Loremaster from the floating chat whenever you need the wider context.
		</p>
	</header>

	<nav aria-label="Explore campaign lore">
		<ul>
			{#each documentTypes as type}
				{@const metadata = documentTypeMetadata[type]}
				<li>
					<a href={`/campaigns/${campaignId}/${type}`}>
						<span class="icon" aria-hidden="true">
							<Icon icon={metadata.icon} />
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
		padding: clamp(1.5rem, 4vw, 3.25rem) 0 0;
		color: #2e281f;
	}

	.intro {
		max-width: 42rem;
		margin-bottom: 1.5rem;
		color: #f5ead6;
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		color: #896a37;
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
		color: #c9beaa;
		line-height: 1.55;
	}

	ul {
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

	.icon :global(svg),
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
</style>
