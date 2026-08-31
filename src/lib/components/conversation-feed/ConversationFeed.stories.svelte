<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import ConversationFeed from './ConversationFeed.svelte'

	type ConversationFeedArgs = ComponentProps<typeof ConversationFeed>

	const emptyArgs = {
		messages: []
	} satisfies ConversationFeedArgs

	const conversationArgs = {
		messages: [
			{
				id: 'message-1',
				role: 'user',
				content: 'What is known about the Ashen Crown?',
				sources: []
			},
			{
				id: 'message-2',
				role: 'assistant',
				content:
					'The Ashen Crown was last carried into the northern ruins, where its bearer disappeared.',
				sources: [
					{
						id: 'source-1',
						title: 'The Northern Expedition',
						type: 'session'
					}
				]
			}
		]
	} satisfies ConversationFeedArgs

	const { Story } = defineMeta({
		title: 'Components/ConversationFeed',
		component: ConversationFeed,
		tags: ['autodocs']
	})
</script>

<Story name="Empty" args={emptyArgs} />

<Story name="Conversation" args={conversationArgs} />
