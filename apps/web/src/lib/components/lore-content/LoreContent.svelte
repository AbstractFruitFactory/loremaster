<script lang="ts">
	import { parseLoreBlocks } from '#lib/lore-content.js'

	let { content }: { content: string } = $props()

	const blocks = $derived(parseLoreBlocks(content))
</script>

{#if blocks.length}
	<div class="lore-content">
		{#each blocks as block, index (index)}
			{#if block.type === 'heading'}
				<svelte:element this={`h${block.level}`} class="lore-heading">
					{block.text}
				</svelte:element>
			{:else if block.type === 'paragraph'}
				<p>{block.text}</p>
			{:else}
				<ul>
					{#each block.items as item, itemIndex (itemIndex)}
						<li>{item}</li>
					{/each}
				</ul>
			{/if}
		{/each}
	</div>
{:else}
	<p class="empty">No lore content yet.</p>
{/if}

<style>
	.lore-content {
		display: grid;
		gap: 0.85rem;
		color: var(--ink, #282016);
		font-family: var(--font-sans);
		line-height: 1.65;
	}

	p,
	ul {
		margin: 0;
	}

	ul {
		display: grid;
		gap: 0.35rem;
		padding-left: 1.2rem;
	}

	.lore-heading {
		margin: 0.35rem 0 0;
		color: var(--ink, #282016);
		font-family: var(--font-display);
		font-weight: 600;
		line-height: 1.2;
	}

	h2.lore-heading {
		font-size: 1.45rem;
	}

	h3.lore-heading {
		font-size: 1.15rem;
	}

	.empty {
		margin: 0;
		color: var(--ink-soft, #6f604e);
		font-style: italic;
	}
</style>
