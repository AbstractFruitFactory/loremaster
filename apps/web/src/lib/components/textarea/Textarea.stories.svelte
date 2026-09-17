<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import Textarea from './Textarea.svelte'

	type TextareaArgs = ComponentProps<typeof Textarea>

	const defaultArgs = {
		placeholder: 'Describe the lore you want to preserve…',
		rows: 4,
		value: ''
	} satisfies Partial<TextareaArgs>

	const disabledArgs = {
		disabled: true,
		rows: 4,
		value: 'An ancient crown forged from blackened silver.'
	} satisfies Partial<TextareaArgs>

	const { Story } = defineMeta({
		title: 'Components/Textarea',
		component: Textarea,
		tags: ['autodocs']
	})
</script>

<Story name="Default" args={defaultArgs} />

<Story name="Disabled" args={disabledArgs} />
