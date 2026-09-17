<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import DocumentDetail from './DocumentDetail.svelte'

	type DocumentDetailArgs = ComponentProps<typeof DocumentDetail>

	const document = {
		id: 'document-ashen-crown',
		title: 'The Ashen Crown',
		type: 'worldbuilding',
		content: `# The Ashen Crown

An ancient crown forged from blackened silver.

## History

The crown was last seen during the northern expedition, when [[The Oath of Emberwatch]] was still honored.

## Current rumors

- It may rest beneath Westgate
- Only a blood heir can wear it safely`,
		currentRevisionId: '45ed8eba-3816-4b21-82ce-217f97c544bc'
	} satisfies NonNullable<DocumentDetailArgs['document']>

	const onsave = async () => {}

	const loadedArgs = {
		selectedType: 'worldbuilding',
		document,
		isLoading: false,
		hasLoadError: false,
		typeMismatch: false,
		backHref: '/campaigns/demo/worldbuilding',
		historyHref: '/campaigns/demo/worldbuilding/document-ashen-crown/history',
		onsave
	} satisfies DocumentDetailArgs

	const loadingArgs = {
		selectedType: 'worldbuilding',
		document: undefined,
		isLoading: true,
		hasLoadError: false,
		typeMismatch: false,
		backHref: '/campaigns/demo/worldbuilding',
		historyHref: '/campaigns/demo/worldbuilding/document-ashen-crown/history',
		onsave
	} satisfies DocumentDetailArgs

	const loadErrorArgs = {
		selectedType: 'worldbuilding',
		document: undefined,
		isLoading: false,
		hasLoadError: true,
		typeMismatch: false,
		backHref: '/campaigns/demo/worldbuilding',
		historyHref: '/campaigns/demo/worldbuilding/document-ashen-crown/history',
		onsave
	} satisfies DocumentDetailArgs

	const { Story } = defineMeta({
		title: 'Pages/DocumentDetail',
		component: DocumentDetail,
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

<Story name="Loading" args={loadingArgs} />

<Story name="Load error" args={loadErrorArgs} />
