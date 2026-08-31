<script lang="ts">
	import type { Snippet } from 'svelte'

	let { children }: { children?: Snippet } = $props()
</script>

<header class="header">
	<div class="content">
		{@render children?.()}
	</div>
</header>

<style>
	.header {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		min-width: 0;
		min-height: 4.75rem;
		padding: 1rem clamp(1.25rem, 4vw, 2.5rem);
		border-bottom: 1px solid rgb(122 91 50 / 28%);
		color: #3b2d1f;
		font-family: var(--font-sans);
	}

	.content {
		width: 100%;
		min-width: 0;
	}

	@media (max-width: 40rem) {
		.header {
			min-height: 4.25rem;
			padding: 0.875rem 1rem;
		}
	}
</style>
