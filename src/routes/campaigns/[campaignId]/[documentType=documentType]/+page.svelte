<script lang="ts">
	import Documents from '#lib/pages/documents/Documents.svelte'
	import type { PageProps } from './$types'
	import { listDocumentsByType } from '../data.remote'

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)
	const selectedType = $derived(params.documentType)
	const documents = $derived(listDocumentsByType({ campaignId, type: selectedType }))
</script>

<Documents
	{campaignId}
	{selectedType}
	documents={documents.current}
	isLoading={documents.loading && !documents.current}
	hasLoadError={Boolean(documents.error)}
/>
