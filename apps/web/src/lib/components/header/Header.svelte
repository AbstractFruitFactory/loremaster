<script lang="ts">
	import type { Snippet } from 'svelte'

	let {
		brand,
		children,
		navigation,
		actions
	}: { brand?: Snippet; children?: Snippet; navigation?: Snippet; actions?: Snippet } = $props()
</script>

<header class="header">
	<div class="primary">
		{#if brand}<div class="brand">{@render brand()}</div>{/if}
		<div class="content">{@render children?.()}</div>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
	{#if navigation}<div class="navigation">{@render navigation()}</div>{/if}
</header>

<style>
	.header {
		box-sizing: border-box;
		display: flex;
		min-width: 0;
		padding: 0.15rem var(--campaign-inline-padding, 0) 0.45rem;
		flex-direction: column;
		gap: 0.55rem;
		color: #f3e8d2;
		font-family: var(--font-sans);
	}

	.primary {
		display: flex;
		min-height: 2.4rem;
		align-items: center;
		gap: 0.7rem;
	}

	.brand,
	.actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
	}

	.content {
		flex: 1;
		min-width: 0;
	}

	.navigation {
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.navigation::-webkit-scrollbar {
		display: none;
	}

	@media (max-width: 40rem) {
		.header {
			padding: 0.1rem var(--campaign-inline-padding, 0) 0.35rem;
		}
	}
</style>
