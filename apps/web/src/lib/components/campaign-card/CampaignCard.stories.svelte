<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import CampaignCard from './CampaignCard.svelte'

	const campaignArgs = {
		name: 'The Ashen Crown',
		description: 'A campaign of forgotten kingdoms, dangerous relics, and old alliances.',
		href: '/campaigns/ashen-crown'
	} satisfies ComponentProps<typeof CampaignCard>

	const { Story } = defineMeta({
		title: 'Components/CampaignCard',
		component: CampaignCard,
		tags: ['autodocs']
	})
</script>

<Story name="Campaign" args={campaignArgs} />
