<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import ChooseCampaign from './ChooseCampaign.svelte'

	type ChooseCampaignArgs = ComponentProps<typeof ChooseCampaign>

	const oncreate: ChooseCampaignArgs['oncreate'] = async () => {}

	const campaigns = [
		{
			id: 'campaign-ashen-crown',
			name: 'The Ashen Crown',
			description: 'Forgotten kingdoms, dangerous relics, and alliances tested by an ancient oath.',
			createdAt: '2026-01-12T14:30:00.000Z'
		},
		{
			id: 'campaign-verdant-depths',
			name: 'The Verdant Depths',
			description:
				'An expedition beneath a living forest where every path remembers its travelers.',
			createdAt: '2026-03-04T09:15:00.000Z'
		},
		{
			id: 'campaign-stars-below',
			name: 'Stars Below',
			description: 'A seafaring chronicle chasing fallen constellations across an uncharted ocean.',
			createdAt: '2026-06-21T18:45:00.000Z'
		}
	] satisfies NonNullable<ChooseCampaignArgs['campaigns']>

	const loadedArgs = {
		campaigns,
		isLoading: false,
		hasLoadError: false,
		oncreate
	} satisfies ChooseCampaignArgs

	const emptyArgs = {
		campaigns: [],
		isLoading: false,
		hasLoadError: false,
		oncreate
	} satisfies ChooseCampaignArgs

	const loadingArgs = {
		campaigns: undefined,
		isLoading: true,
		hasLoadError: false,
		oncreate
	} satisfies ChooseCampaignArgs

	const loadErrorArgs = {
		campaigns: undefined,
		isLoading: false,
		hasLoadError: true,
		oncreate
	} satisfies ChooseCampaignArgs

	const { Story } = defineMeta({
		title: 'Pages/ChooseCampaign',
		component: ChooseCampaign,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		}
	})
</script>

<Story name="Loaded" args={loadedArgs} />

<Story name="Empty" args={emptyArgs} />

<Story name="Loading" args={loadingArgs} />

<Story name="Load error" args={loadErrorArgs} />
