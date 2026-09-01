<script lang="ts">
	import { streamAssistant } from '#lib/assistant-stream.js'
	import Campaign from '#lib/pages/campaign/Campaign.svelte'
	import type { AddLoreInput, AskLoremasterInput } from '#lib/pages/campaign/Campaign.svelte'
	import type { PageProps } from './$types'
	import { createLore } from './data.remote'

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)

	const handleAsk = (input: AskLoremasterInput, signal: AbortSignal) =>
		streamAssistant(campaignId, input, { signal })

	const handleAddLore = (draft: AddLoreInput) => createLore({ campaignId, ...draft })
</script>

<Campaign onask={handleAsk} onaddlore={handleAddLore} />
