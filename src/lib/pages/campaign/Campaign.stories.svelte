<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import Campaign from './Campaign.svelte'

	type CampaignArgs = ComponentProps<typeof Campaign>

	const onask: CampaignArgs['onask'] = async function* ({ message }) {
		yield {
			type: 'sources',
			sources: [
				{
					id: 'source-emberwatch-oath',
					title: 'The Oath of Emberwatch',
					type: 'lore'
				}
			]
		}
		yield {
			type: 'text-delta',
			delta: `The Ashen Crown is bound to the oath spoken at Emberwatch. Your question, “${message}”, points to the missing verse recorded after the northern expedition.`
		}
		yield {
			type: 'proposal',
			proposal: {
				title: 'The Missing Verse of Emberwatch',
				category: 'event',
				content:
					'The final verse of the Emberwatch oath binds the bearer of the Ashen Crown to return before the first winter moon.'
			}
		}
		yield { type: 'done' }
	}

	const onaddlore: CampaignArgs['onaddlore'] = async ({ title }) => ({ title })

	const interactiveArgs = {
		onask,
		onaddlore
	} satisfies CampaignArgs

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

<Story name="Interactive" args={interactiveArgs} />
