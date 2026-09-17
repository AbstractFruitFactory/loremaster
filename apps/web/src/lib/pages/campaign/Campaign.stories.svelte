<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Campaign from './Campaign.svelte'

	const interactiveArgs = {
		campaignId: 'campaign-1'
	}

	const { Story } = defineMeta({
		title: 'Pages/Campaign',
		component: Campaign,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen',
			backgrounds: {
				default: 'parchment',
				values: [{ name: 'parchment', value: '#eee0c6' }]
			}
		}
	})
</script>

<Story name="Overview" args={interactiveArgs} />
