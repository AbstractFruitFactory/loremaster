<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import DocumentDetail from './DocumentDetail.svelte'

	type DocumentDetailArgs = ComponentProps<typeof DocumentDetail>

	const document = {
		id: 'document-ashen-crown',
		path: 'lore/the-ashen-crown.md',
		title: 'The Ashen Crown',
		type: 'lore',
		aliases: ['Crown of Ash'],
		after: [],
		summary:
			'The Ashen Crown is an ancient relic tied to the northern expedition and the fall of Emberwatch.',
		content: `# The Ashen Crown

An ancient crown forged from blackened silver.

## History

The crown was last seen during the northern expedition, when [[The Oath of Emberwatch]] was still honored.

## Current rumors

- It may rest beneath Westgate
- Only a blood heir can wear it safely`,
		links: ['The Oath of Emberwatch']
	} satisfies NonNullable<DocumentDetailArgs['document']>

	const loadedArgs = {
		selectedType: 'lore',
		document,
		isLoading: false,
		hasLoadError: false,
		typeMismatch: false,
		backHref: '/campaigns/demo/lore'
	} satisfies DocumentDetailArgs

	const loadingArgs = {
		selectedType: 'lore',
		document: undefined,
		isLoading: true,
		hasLoadError: false,
		typeMismatch: false,
		backHref: '/campaigns/demo/lore'
	} satisfies DocumentDetailArgs

	const loadErrorArgs = {
		selectedType: 'lore',
		document: undefined,
		isLoading: false,
		hasLoadError: true,
		typeMismatch: false,
		backHref: '/campaigns/demo/lore'
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
