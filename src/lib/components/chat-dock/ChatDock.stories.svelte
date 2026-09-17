<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'
	import ChatDock from './ChatDock.svelte'

	type ChatDockArgs = ComponentProps<typeof ChatDock>

	const onask: ChatDockArgs['onask'] = async function* ({ message }) {
		yield {
			type: 'sources',
			sources: [{ id: 'source-1', title: 'The Oath of Emberwatch', type: 'worldbuilding' }]
		}
		yield {
			type: 'text-delta',
			delta: `The Ashen Crown is bound to the oath spoken at Emberwatch. “${message}” connects to the missing final verse.`
		}
		yield { type: 'done' }
	}

	const onaddlore: ChatDockArgs['onaddlore'] = async ({ title }) => ({ title })

	const defaultArgs = {
		campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
		conversationHistory: [],
		onask,
		onaddlore
	} satisfies ChatDockArgs

	const { Story } = defineMeta({
		title: 'Components/ChatDock',
		component: ChatDock,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	})
</script>

{#snippet stage(args: ChatDockArgs)}
	<div class="stage">
		<ChatDock {...args} />
	</div>
{/snippet}

<Story name="Collapsed" args={defaultArgs} template={stage} />
<Story name="Open" args={{ ...defaultArgs, open: true }} template={stage} />

<style>
	.stage {
		position: relative;
		height: 46rem;
		background: #2b3732;
	}
</style>
