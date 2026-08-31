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
	<a {href}>Open campaign <span aria-hidden="true">→</span></a>
</article>

<style>
	.campaign-card {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 10.5rem;
		padding: 1.2rem;
		border: 1px solid rgb(154 120 67 / 48%);
		background: rgb(250 240 219 / 62%);
		box-shadow: 0 0.35rem 1rem rgb(75 52 27 / 5%);
		transition:
			border-color 180ms ease,
			box-shadow 180ms ease,
			transform 180ms ease;
	}

	.campaign-card::before,
	.campaign-card::after {
		position: absolute;
		width: 1rem;
		height: 1rem;
		border-color: var(--gold, #9a7843);
		content: '';
		pointer-events: none;
	}

	.campaign-card::before {
		top: 0.45rem;
		left: 0.45rem;
		border-top: 1px solid;
		border-left: 1px solid;
	}

	.campaign-card::after {
		right: 0.45rem;
		bottom: 0.45rem;
		border-right: 1px solid;
		border-bottom: 1px solid;
	}

	.campaign-card:hover {
		border-color: var(--gold, #9a7843);
		box-shadow: 0 0.9rem 1.8rem rgb(75 52 27 / 11%);
		transform: translateY(-3px);
	}

	.card-ornament {
		margin-bottom: 0.6rem;
		color: var(--gold, #9a7843);
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
		outline: 2px solid var(--gold, #9a7843);
		outline-offset: 4px;
	}

	@media (prefers-reduced-motion: reduce) {
		.campaign-card {
			transition: none;
		}
	}
</style>
