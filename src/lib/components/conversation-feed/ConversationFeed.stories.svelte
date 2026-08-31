<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import ConversationFeed from './ConversationFeed.svelte'

	type ConversationFeedArgs = ComponentProps<typeof ConversationFeed>

	const proposalCategoryOptions: ConversationFeedArgs['proposalCategoryOptions'] = [
		{ value: 'player', label: 'Players' },
		{ value: 'npc', label: 'NPCs' },
		{ value: 'location', label: 'Locations' },
		{ value: 'session', label: 'Sessions' },
		{ value: 'item', label: 'Items' },
		{ value: 'lore', label: 'Lore' },
		{ value: 'event', label: 'Events' }
	]

	const baseArgs = {
		proposal: null,
		proposalCategoryOptions,
		onproposalsave: () => {},
		onproposalcancel: () => {}
	} satisfies Omit<ConversationFeedArgs, 'messages'>

	const emptyArgs = {
		...baseArgs,
		messages: []
	} satisfies ConversationFeedArgs

	const conversationArgs = {
		...baseArgs,
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

	const proposalArgs = {
		...conversationArgs,
		proposal: {
			messageId: 'message-2',
			draft: {
				title: 'The Ashen Crown',
				category: 'item',
				content:
					'An ancient crown forged from blackened silver, last seen during the northern expedition.'
			}
		}
	} satisfies ConversationFeedArgs

	const longConversationArgs = {
		...baseArgs,
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

<Story name="Conversation with proposal" args={proposalArgs} />

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
