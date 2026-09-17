<script lang="ts">
	import ChooseCampaign from '#lib/pages/choose-campaign/ChooseCampaign.svelte'
	import { createCampaign, listCampaigns } from './data.remote'

	const campaigns = listCampaigns()

	const handleCreate = async (input: { name: string; description: string }) => {
		await createCampaign(input)
		await campaigns.refresh()
	}
</script>

<ChooseCampaign
	campaigns={campaigns.current}
	isLoading={campaigns.loading && !campaigns.current}
	hasLoadError={Boolean(campaigns.error)}
	oncreate={handleCreate}
/>
