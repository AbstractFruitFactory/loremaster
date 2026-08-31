<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import TextInput from './TextInput.svelte'

	type TextInputArgs = ComponentProps<typeof TextInput>

	const defaultArgs = {
		placeholder: 'Name this lore entry',
		value: ''
	} satisfies Partial<TextInputArgs>

	const disabledArgs = {
		disabled: true,
		placeholder: 'Name this lore entry',
		value: 'The Ashen Crown'
	} satisfies Partial<TextInputArgs>

	const { Story } = defineMeta({
		title: 'Components/TextInput',
		component: TextInput,
		tags: ['autodocs']
	})
</script>

<Story name="Default" args={defaultArgs} />

<Story name="Disabled" args={disabledArgs} />
