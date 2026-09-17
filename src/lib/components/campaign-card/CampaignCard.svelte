<script lang="ts">
	let {
		name,
		description,
		href
	}: {
		name: string
		description: string
		href: string
	} = $props()
</script>

<article class="campaign-card">
	<div class="card-ornament" aria-hidden="true">✦</div>
	<h3>{name}</h3>
	<p>{description}</p>
	<a {href} aria-label={`Open ${name} campaign`}>
		Open campaign <span aria-hidden="true">→</span>
	</a>
</article>

<style>
	.campaign-card {
		--card-ink: var(--color-text, #25231f);
		--card-paper: #fffdf7;
		--card-accent: #d77d57;

		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 10.5rem;
		padding: 1.2rem;
		border: 2px solid var(--card-ink);
		border-radius: 2px;
		background: var(--card-paper);
		box-shadow: 0.25rem 0.25rem 0 var(--card-ink);
		transition:
			background-color 120ms ease,
			transform 120ms ease;
	}

	.campaign-card:hover {
		background: #fffaf0;
		transform: translate(-0.125rem, -0.125rem);
	}

	.card-ornament {
		margin-bottom: 0.6rem;
		color: var(--card-accent);
		font-size: 1rem;
		line-height: 1;
	}

	h3,
	p {
		margin-top: 0;
	}

	h3 {
		margin-bottom: 0.4rem;
		font-family: var(--font-display);
		font-size: 1.45rem;
		font-weight: 600;
		line-height: 1.1;
		text-wrap: balance;
	}

	p {
		margin-bottom: 1rem;
		color: var(--ink-soft, #6f604e);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	a {
		align-self: flex-start;
		margin-top: auto;
		color: #36503a;
		font-size: 0.84rem;
		font-weight: 700;
		letter-spacing: 0.045em;
		text-underline-offset: 0.22em;
	}

	a:hover {
		color: var(--ink, #282016);
	}

	a:focus-visible {
		border-radius: 2px;
		outline: 2px solid var(--color-focus, #3e4b39);
		outline-offset: 4px;
	}

	@media (prefers-reduced-motion: reduce) {
		.campaign-card {
			transition: none;
		}
	}
</style>
