<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import DocumentDiff from './DocumentDiff.svelte'

	type DocumentDiffArgs = ComponentProps<typeof DocumentDiff>

	const diff = {
		fromRevisionId: '62efc68e-9cff-4300-8864-0491a5ef533a',
		toRevisionId: '9bfc8676-2df0-4679-a548-c8cc8f3bb547',
		hunks: [
			{
				oldStart: 1,
				newStart: 1,
				lines: [
					{ type: 'context', line: '# The Ashen Crown' },
					{ type: 'context', line: '' },
					{ type: 'removed', line: 'The crown was lost beneath Westgate.' },
					{ type: 'added', line: 'The crown was recovered beneath Westgate.' },
					{ type: 'added', line: 'Only a blood heir can wear it safely.' }
				]
			}
		],
		truncated: false,
		omittedLineCount: 0
	} satisfies NonNullable<DocumentDiffArgs['diff']>

	const loadedArgs = {
		diff,
		isLoading: false,
		hasLoadError: false
	} satisfies DocumentDiffArgs

	const emptyArgs = {
		diff: {
			fromRevisionId: '62efc68e-9cff-4300-8864-0491a5ef533a',
			toRevisionId: '9bfc8676-2df0-4679-a548-c8cc8f3bb547',
			hunks: [],
			truncated: false,
			omittedLineCount: 0
		},
		isLoading: false,
		hasLoadError: false
	} satisfies DocumentDiffArgs

	const truncatedArgs = {
		diff: {
			...diff,
			truncated: true,
			omittedLineCount: 1600
		},
		isLoading: false,
		hasLoadError: false
	} satisfies DocumentDiffArgs

	const loadingArgs = {
		diff: undefined,
		isLoading: true,
		hasLoadError: false
	} satisfies DocumentDiffArgs

	const loadErrorArgs = {
		diff: undefined,
		isLoading: false,
		hasLoadError: true
	} satisfies DocumentDiffArgs

	const { Story } = defineMeta({
		title: 'Pages/DocumentDiff',
		component: DocumentDiff,
		tags: ['autodocs'],
		parameters: {
			backgrounds: {
				default: 'parchment',
				values: [{ name: 'parchment', value: '#eee0c6' }]
			}
		}
	})
</script>

<Story name="Line changes" args={loadedArgs} />

<Story name="Truncated changes" args={truncatedArgs} />

<Story name="No changes" args={emptyArgs} />

<Story name="Loading" args={loadingArgs} />

<Story name="Load error" args={loadErrorArgs} />
