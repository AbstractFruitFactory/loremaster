<script lang="ts">
	import Documents from '#lib/pages/documents/Documents.svelte'
	import Sessions from '#lib/pages/documents/Sessions.svelte'
	import type { PageProps } from './$types'
	import {
		discardSessionIngestion,
		listDocumentsByType,
		listUncommittedSessionIngestions
	} from '../data.remote'

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)
	const selectedType = $derived(params.documentType)
	const documents = $derived(listDocumentsByType({ campaignId, type: selectedType }))
	const uncommittedSessions = $derived(
		selectedType === 'session' ? listUncommittedSessionIngestions(campaignId) : undefined
	)

	const discardUncommittedSession = async (ingestionId: string) => {
		await discardSessionIngestion({ campaignId, ingestionId })
	}

	const reloadUncommittedSessions = async () => {
		await uncommittedSessions?.refresh()
	}
</script>

{#if selectedType === 'session'}
	<Sessions
		{campaignId}
		documents={documents.current}
		isLoading={documents.loading && !documents.current}
		hasLoadError={Boolean(documents.error)}
		uncommittedSessions={uncommittedSessions?.current}
		areUncommittedSessionsLoading={Boolean(
			uncommittedSessions?.loading && !uncommittedSessions.current
		)}
		haveUncommittedSessionsLoadError={Boolean(uncommittedSessions?.error)}
		ondiscardUncommittedSession={discardUncommittedSession}
		onreloadUncommittedSessions={reloadUncommittedSessions}
	/>
{:else}
	<Documents
		{campaignId}
		{selectedType}
		documents={documents.current}
		isLoading={documents.loading && !documents.current}
		hasLoadError={Boolean(documents.error)}
	/>
{/if}
