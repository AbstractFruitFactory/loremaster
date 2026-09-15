<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'

	type WindowProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'class' | 'title'> & {
		title: string
		eyebrow?: string
		icon?: Snippet
		actions?: Snippet
		footer?: Snippet
		children: Snippet
		class?: string
	}

	let {
		title,
		eyebrow,
		icon,
		actions,
		footer,
		children,
		class: className,
		...rest
	}: WindowProps = $props()
</script>

<section {...rest} class={['window', className]} aria-label={title}>
	<header class="header">
		{#if icon}
			<div class="icon" aria-hidden="true">
				<span class="icon-corner top-left"></span>
				<span class="icon-corner top-right"></span>
				<span class="icon-corner bottom-left"></span>
				<span class="icon-corner bottom-right"></span>
				<div class="icon-content">{@render icon()}</div>
			</div>
		{/if}

		<div class="heading">
			{#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
			<h2>{title}</h2>
		</div>

		{#if actions}
			<div class="actions">{@render actions()}</div>
		{/if}
	</header>

	<div class="content">{@render children()}</div>

	{#if footer}
		<footer class="footer">{@render footer()}</footer>
	{/if}
</section>

<style>
	.window {
		--window-ink: var(--color-text, #25231f);
		--window-paper: #fffaf0;
		--window-header: #f1eadc;
		--window-shadow-offset: 0.3125rem;

		position: relative;
		isolation: isolate;
		width: min(100%, 38rem);
		border: 2px solid var(--window-ink);
		border-radius: 2px;
		background: var(--window-paper);
		box-shadow: var(--window-shadow-offset) var(--window-shadow-offset) 0 var(--window-ink);
		color: var(--window-ink);
	}

	.header {
		display: flex;
		min-height: 3.25rem;
		align-items: center;
		gap: 0.7rem;
		padding: 0.55rem 0.8rem;
		border-bottom: 2px solid var(--window-ink);
		background: var(--window-header);
	}

	.icon {
		position: relative;
		display: grid;
		width: 2.15rem;
		height: 2.15rem;
		flex: 0 0 auto;
		place-items: center;
		border: 2px solid var(--window-ink);
		background: var(--window-paper);
	}

	.icon-content {
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.icon-content :global(img),
	.icon-content :global(svg) {
		width: 100%;
		height: 100%;
		padding: 0.08rem;
		object-fit: contain;
	}

	.icon-corner {
		position: absolute;
		z-index: 1;
		width: 0.4rem;
		height: 0.4rem;
		border: 1.5px solid var(--window-ink);
		border-radius: 1px;
		background: #65cfc9;
	}

	.icon-corner.top-left {
		top: -0.2rem;
		left: -0.2rem;
	}

	.icon-corner.top-right {
		top: -0.2rem;
		right: -0.2rem;
	}

	.icon-corner.bottom-left {
		bottom: -0.2rem;
		left: -0.2rem;
	}

	.icon-corner.bottom-right {
		right: -0.2rem;
		bottom: -0.2rem;
	}

	.heading {
		min-width: 0;
	}

	.eyebrow {
		display: block;
		margin-bottom: -0.05rem;
		color: var(--color-muted, #625e57);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		line-height: 1.1;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.2rem;
		font-weight: 600;
		line-height: 1.15;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: auto;
	}

	.content {
		padding: 1rem;
	}

	.footer {
		padding: 0.7rem 1rem;
		border-top: 1px solid rgb(37 35 31 / 24%);
		background: rgb(241 234 220 / 52%);
	}

	@media (max-width: 30rem) {
		.window {
			--window-shadow-offset: 0.25rem;
		}

		.content {
			padding: 0.85rem;
		}
	}
</style>
