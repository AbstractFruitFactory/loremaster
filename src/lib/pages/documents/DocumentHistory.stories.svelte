<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import DocumentHistory from './DocumentHistory.svelte'

	type DocumentHistoryArgs = ComponentProps<typeof DocumentHistory>

	const firstRevisionId = '62efc68e-9cff-4300-8864-0491a5ef533a'
	const currentRevisionId = '9bfc8676-2df0-4679-a548-c8cc8f3bb547'
	const sourceHash = '3f9f190f3f8cb8752b25e379369ee00e00a63afac346beaaf702440c50e0ef17'

	const revisions = [
		{
			schemaVersion: 1,
			revisionId: firstRevisionId,
			previousRevisionId: null,
			transactionId: 'c5541610-e7d6-4b73-94da-06ff5d09f8f7',
			campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
			documentId: 'document-ashen-crown',
			path: 'Lore/The-Ashen-Crown.md',
			operation: 'create',
			source: 'manual',
			createdAt: '2026-08-31T18:12:00.000Z',
			beforeHash: null,
			afterHash: '9d727a65425c3f6b4351382293050110447129d8b2f946c8594e1b9f5676fe08',
			hasSnapshot: true,
			changeSummary: 'Created the Ashen Crown'
		},
		{
			schemaVersion: 1,
			revisionId: currentRevisionId,
			previousRevisionId: firstRevisionId,
			transactionId: 'ca8f45d2-9744-43f3-a76c-e137457ae68f',
			campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
			documentId: 'document-ashen-crown',
			path: 'Lore/The-Ashen-Crown.md',
			operation: 'update',
			source: 'assistant',
			createdAt: '2026-09-01T20:45:00.000Z',
			beforeHash: '9d727a65425c3f6b4351382293050110447129d8b2f946c8594e1b9f5676fe08',
			afterHash: sourceHash,
			hasSnapshot: true,
			changeSummary: 'Recorded the crown’s recovery'
		}
	] satisfies NonNullable<DocumentHistoryArgs['revisions']>

	const deletedRevisions = [
		...revisions,
		{
			...revisions[1],
			revisionId: 'b2f0d1c4-0c8a-4d7a-9c1a-0f3e8b6a91d2',
			previousRevisionId: currentRevisionId,
			transactionId: 'd1a0b3c7-2e54-4f91-8a12-7c4e19d0ab33',
			operation: 'delete',
			source: 'manual',
			createdAt: '2026-09-01T21:10:00.000Z',
			beforeHash: sourceHash,
			afterHash: null,
			hasSnapshot: false,
			changeSummary: 'Deleted the Ashen Crown'
		}
	] satisfies NonNullable<DocumentHistoryArgs['revisions']>

	const diff = {
		fromRevisionId: null,
		toRevisionId: firstRevisionId,
		hunks: [
			{
				oldStart: 1,
				newStart: 1,
				lines: [
					{ type: 'added', line: '# The Ashen Crown' },
					{ type: 'added', line: '' },
					{ type: 'added', line: 'The crown was lost beneath Westgate.' }
				]
			}
		],
		truncated: false,
		omittedLineCount: 0
	} satisfies NonNullable<DocumentHistoryArgs['diff']>

	const loadedArgs = {
		documentTitle: 'The Ashen Crown',
		revisions,
		selectedRevisionId: firstRevisionId,
		diff,
		isLoading: false,
		hasLoadError: false,
		isDiffLoading: false,
		hasDiffError: false,
		backHref: '/campaigns/demo/lore/document-ashen-crown',
		onselect: () => undefined,
		onrestore: async () => undefined
	} satisfies DocumentHistoryArgs

	const staleArgs = {
		...loadedArgs,
		onrestore: async () => {
			throw { status: 409 }
		}
	} satisfies DocumentHistoryArgs

	const deletedArgs = {
		...loadedArgs,
		revisions: deletedRevisions,
		selectedRevisionId: deletedRevisions[2].revisionId,
		diff: {
			fromRevisionId: currentRevisionId,
			toRevisionId: deletedRevisions[2].revisionId,
			hunks: [
				{
					oldStart: 1,
					newStart: 1,
					lines: [
						{ type: 'removed', line: '# The Ashen Crown' },
						{ type: 'removed', line: '' },
						{ type: 'removed', line: 'The crown was recovered beneath Westgate.' }
					]
				}
			],
			truncated: false,
			omittedLineCount: 0
		}
	} satisfies DocumentHistoryArgs

	const emptyArgs = {
		...loadedArgs,
		revisions: [],
		selectedRevisionId: undefined,
		diff: undefined
	} satisfies DocumentHistoryArgs

	const loadingArgs = {
		...emptyArgs,
		revisions: undefined,
		isLoading: true
	} satisfies DocumentHistoryArgs

	const loadErrorArgs = {
		...loadingArgs,
		isLoading: false,
		hasLoadError: true
	} satisfies DocumentHistoryArgs

	const { Story } = defineMeta({
		title: 'Pages/DocumentHistory',
		component: DocumentHistory,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen',
			backgrounds: {
				default: 'parchment',
				values: [{ name: 'parchment', value: '#eee0c6' }]
			}
		}
	})
</script>

<Story name="Loaded revision" args={loadedArgs} />

<Story name="Stale restore conflict" args={staleArgs} />

<Story name="Deleted snapshot" args={deletedArgs} />

<Story name="Empty" args={emptyArgs} />

<Story name="Loading" args={loadingArgs} />

<Story name="Load error" args={loadErrorArgs} />
