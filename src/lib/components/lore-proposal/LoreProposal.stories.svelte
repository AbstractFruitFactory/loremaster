<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import LoreProposal from './LoreProposal.svelte'

	type LoreProposalArgs = ComponentProps<typeof LoreProposal>

	const proposalArgs = {
		proposal: {
			title: 'The Ashen Crown',
			category: 'item',
			content:
				'An ancient crown forged from blackened silver, last seen during the northern expedition.'
		},
		categoryOptions: [
			{ value: 'player', label: 'Players' },
			{ value: 'npc', label: 'NPCs' },
			{ value: 'location', label: 'Locations' },
			{ value: 'session', label: 'Sessions' },
			{ value: 'item', label: 'Items' },
			{ value: 'lore', label: 'Lore' },
			{ value: 'event', label: 'Events' }
		],
		onsave: () => {},
		oncancel: () => {}
	} satisfies LoreProposalArgs

	const { Story } = defineMeta({
		title: 'Components/LoreProposal',
		component: LoreProposal,
		tags: ['autodocs']
	})
</script>

<Story name="Draft" args={proposalArgs} />
