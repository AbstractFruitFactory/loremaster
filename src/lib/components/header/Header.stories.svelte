<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import Header from './Header.svelte'

	type HeaderArgs = ComponentProps<typeof Header>

	const { Story } = defineMeta({
		title: 'Components/Header',
		component: Header,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen',
			backgrounds: {
				default: 'forest',
				values: [{ name: 'forest', value: '#2b3732' }]
			}
		}
	})
</script>

{#snippet campaignHeader(_args: HeaderArgs)}
	<Header>
		<h2>The Ashen Crown</h2>
	</Header>
{/snippet}

<Story name="Campaign header" template={campaignHeader} />

<style>
	h2 {
		margin: 0;
		overflow-wrap: anywhere;
		color: #f3e8d2;
		font-family: var(--font-display);
		font-size: clamp(1.35rem, 3vw, 1.8rem);
		font-weight: 600;
		letter-spacing: 0.025em;
		line-height: 1.15;
	}
</style>
