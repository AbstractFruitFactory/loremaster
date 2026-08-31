<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import Documents from './Documents.svelte'

	type DocumentsArgs = ComponentProps<typeof Documents>

	const documents = [
		{
			id: 'document-ashen-crown',
			path: 'lore/the-ashen-crown.md',
			title: 'The Ashen Crown',
			type: 'lore',
			aliases: ['Crown of Ash'],
			after: [],
			summary:
				'The Ashen Crown is a campaign lore entry the Dungeon Master can reference at the table.',
			links: ['document-emberwatch-oath']
		},
		{
			id: 'document-emberwatch-oath',
			path: 'lore/the-oath-of-emberwatch.md',
			title: 'The Oath of Emberwatch',
			type: 'lore',
			after: [],
			summary:
				'The Oath of Emberwatch is a campaign lore entry the Dungeon Master can reference at the table.',
			links: []
		}
	] satisfies NonNullable<DocumentsArgs['documents']>

	const loadedArgs = {
		campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
		selectedType: 'lore',
		documents,
		isLoading: false,
		hasLoadError: false
	} satisfies DocumentsArgs

	const emptyArgs = {
		campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
		selectedType: 'event',
		documents: [],
		isLoading: false,
		hasLoadError: false
	} satisfies DocumentsArgs

	const loadingArgs = {
		campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
		selectedType: 'location',
		documents: undefined,
		isLoading: true,
		hasLoadError: false
	} satisfies DocumentsArgs

	const loadErrorArgs = {
		campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
		selectedType: 'npc',
		documents: undefined,
		isLoading: false,
		hasLoadError: true
	} satisfies DocumentsArgs

	const { Story } = defineMeta({
		title: 'Pages/Documents',
		component: Documents,
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

<Story name="Loaded" args={loadedArgs} />

<Story name="Empty" args={emptyArgs} />

<Story name="Loading" args={loadingArgs} />

<Story name="Load error" args={loadErrorArgs} />
