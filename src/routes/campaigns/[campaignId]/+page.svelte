<script lang="ts">
	import Campaign from '#lib/pages/campaign/Campaign.svelte'
	import type { AddLoreInput, AskLoremasterInput } from '#lib/pages/campaign/Campaign.svelte'
	import type { PageProps } from './$types'
	import { askLoremaster, createLore } from './data.remote'

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)

	const handleAsk = (input: AskLoremasterInput) => askLoremaster({ campaignId, ...input })

	const handleAddLore = (draft: AddLoreInput) => createLore({ campaignId, ...draft })
</script>

<Campaign onask={handleAsk} onaddlore={handleAddLore} />
