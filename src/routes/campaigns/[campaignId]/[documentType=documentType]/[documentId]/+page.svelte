<script lang="ts">
	import DocumentDetail from '#lib/pages/documents/DocumentDetail.svelte'
	import type { PageProps } from './$types'
	import { getDocument } from '../../data.remote'

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)
	const selectedType = $derived(params.documentType)
	const documentId = $derived(params.documentId)
	const document = $derived(getDocument({ campaignId, documentId }))
	const backHref = $derived(`/campaigns/${campaignId}/${selectedType}`)
	const typeMismatch = $derived(Boolean(document.current && document.current.type !== selectedType))
</script>

<DocumentDetail
	{selectedType}
	document={document.current}
	isLoading={document.loading && !document.current}
	hasLoadError={Boolean(document.error)}
	{typeMismatch}
	{backHref}
/>
