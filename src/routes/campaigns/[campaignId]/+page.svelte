<script lang="ts">
	import Campaign from '#lib/pages/campaign/Campaign.svelte'
	import type { PageProps } from './$types'

	let { params }: PageProps = $props()
</script>

<Campaign campaignId={params.campaignId} />
