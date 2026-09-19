<script lang="ts">
	import type { PageProps } from './$types'
	import CampaignImportReviewHost from '#lib/components/import/CampaignImportReviewHost.svelte'
	import {
		commitCampaignImport,
		commitCampaignImportChronology,
		finishCampaignImport,
		getCampaignImport,
		getCampaignImportLifecycle,
		getCampaignImportReviewState,
		listDocuments,
		retryCampaignImportAnalysis,
		retryCampaignImportChronologyAnalysis,
		retryCampaignImportChronologyCommit,
		retryCampaignImportCommit,
		saveCampaignImportReviewState
	} from '../../data.remote'

	let { params }: PageProps = $props()
	const importReference = $derived({
		campaignId: params.campaignId,
		ingestionId: params.ingestionId
	})
</script>

{#key `${params.campaignId}:${params.ingestionId}`}
	<CampaignImportReviewHost
		campaignId={params.campaignId}
		ingestionId={params.ingestionId}
		queries={{
			lifecycle: getCampaignImportLifecycle(importReference),
			draft: getCampaignImport(importReference),
			reviewState: getCampaignImportReviewState(importReference)
		}}
		actions={{
			saveReviewState: saveCampaignImportReviewState,
			commit: commitCampaignImport,
			commitChronology: commitCampaignImportChronology,
			finish: finishCampaignImport,
			retryAnalysis: retryCampaignImportAnalysis,
			retryCommit: retryCampaignImportCommit,
			retryChronology: retryCampaignImportChronologyAnalysis,
			retryChronologyCommit: retryCampaignImportChronologyCommit,
			refreshDocuments: (campaignId) => listDocuments(campaignId).refresh()
		}}
	/>
{/key}
