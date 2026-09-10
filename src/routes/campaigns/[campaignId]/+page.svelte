<script lang="ts">
	import { streamAssistant } from '#lib/assistant-stream.js'
	import Campaign from '#lib/pages/campaign/Campaign.svelte'
	import type { AddLoreInput, AskLoremasterInput } from '#lib/pages/campaign/Campaign.svelte'
	import type { PageProps } from './$types'
	import { getConversationHistory } from './conversation.remote'
	import { createLore } from './data.remote'

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)
	const conversation = $derived(getConversationHistory(campaignId))

	const handleAsk = (input: AskLoremasterInput, signal: AbortSignal) =>
		streamAssistant(campaignId, input, { signal })
	const handleAddLore = (draft: AddLoreInput) => createLore({ campaignId, ...draft })
</script>

{#if conversation.current !== undefined}
	{#key campaignId}
		<Campaign
			conversationHistory={conversation.current}
			onask={handleAsk}
			onaddlore={handleAddLore}
		/>
	{/key}
{:else if conversation.error}
	<p role="alert">Unable to load conversation.</p>
{/if}
