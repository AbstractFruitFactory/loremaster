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
			links: ['document-emberwatch-oath']
		},
		{
			id: 'document-emberwatch-oath',
			path: 'lore/the-oath-of-emberwatch.md',
			title: 'The Oath of Emberwatch',
			type: 'lore',
			after: [],
			links: []
		}
	] satisfies NonNullable<DocumentsArgs['documents']>

	const loadedArgs = {
		selectedType: 'lore',
		documents,
		isLoading: false,
		hasLoadError: false
	} satisfies DocumentsArgs

	const emptyArgs = {
		selectedType: 'event',
		documents: [],
		isLoading: false,
		hasLoadError: false
	} satisfies DocumentsArgs

	const loadingArgs = {
		selectedType: 'location',
		documents: undefined,
		isLoading: true,
		hasLoadError: false
	} satisfies DocumentsArgs

	const loadErrorArgs = {
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
