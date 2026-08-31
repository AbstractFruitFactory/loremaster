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

	const longConversationArgs = {
		messages: Array.from({ length: 14 }, (_, index) => ({
			id: `long-message-${index + 1}`,
			role: index % 2 === 0 ? 'user' : 'assistant',
			content:
				index % 2 === 0
					? `Question ${index / 2 + 1}: What changed in the realm after the last session?`
					: `Answer ${(index + 1) / 2}: The latest records describe shifting alliances, newly revealed paths, and consequences that the party will need to confront.`,
			sources: []
		}))
	} satisfies ConversationFeedArgs

	const { Story } = defineMeta({
		title: 'Components/ConversationFeed',
		component: ConversationFeed,
		tags: ['autodocs']
	})
</script>

{#snippet longConversation(args: ConversationFeedArgs)}
	<div class="feed-frame">
		<ConversationFeed {...args} />
	</div>
{/snippet}

<Story name="Empty" args={emptyArgs} />

<Story name="Conversation" args={conversationArgs} />

<Story name="Long conversation" args={longConversationArgs} template={longConversation} />

<style>
	.feed-frame {
		display: flex;
		height: 26rem;
		min-height: 0;
		flex-direction: column;
		border: 1px solid #c7ad7d;
		background: #eee0c6;
	}
</style>
