<script lang="ts">
	import DocumentHistory from '#lib/pages/documents/DocumentHistory.svelte'
	import type { PageProps } from './$types'
	import {
		diffDocumentRevisions,
		getDocument,
		listDocumentRevisions,
		restoreDocumentRevision
	} from '../../../data.remote'

	let { params }: PageProps = $props()

	let selectedRevisionId = $state<string>()

	const campaignId = $derived(params.campaignId)
	const selectedType = $derived(params.documentType)
	const documentId = $derived(params.documentId)
	const document = $derived(getDocument({ campaignId, documentId }))
	const history = $derived(listDocumentRevisions({ campaignId, documentId }))
	const sortedRevisions = $derived(
		history.current?.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)) ?? []
	)
	const selectedRevision = $derived(
		sortedRevisions.find((revision) => revision.revisionId === selectedRevisionId) ??
			sortedRevisions[0]
	)
	const diff = $derived(
		selectedRevision
			? diffDocumentRevisions({
					campaignId,
					documentId,
					toRevisionId: selectedRevision.revisionId
				})
			: undefined
	)
	const backHref = $derived(`/campaigns/${campaignId}/${selectedType}/${documentId}`)

	async function restoreRevision(request: {
		revisionId: string
		expectedSourceHash: string | null
		currentRevisionId: string
	}) {
		await restoreDocumentRevision({
			campaignId,
			documentId,
			currentDocumentType: selectedType,
			...request
		})
		selectedRevisionId = undefined
	}
</script>

<DocumentHistory
	documentTitle={document.current?.title}
	revisions={history.current}
	{selectedRevisionId}
	diff={diff?.current}
	isLoading={history.loading && !history.current}
	hasLoadError={Boolean(history.error)}
	isDiffLoading={Boolean(diff?.loading && !diff.current)}
	hasDiffError={Boolean(diff?.error)}
	{backHref}
	onselect={(revisionId) => (selectedRevisionId = revisionId)}
	onrestore={restoreRevision}
/>
