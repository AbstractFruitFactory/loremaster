<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import ChatInput from './ChatInput.svelte'

	type ChatInputArgs = ComponentProps<typeof ChatInput>

	const onsubmit: ChatInputArgs['onsubmit'] = async () => {}

	const defaultArgs = {
		onsubmit,
		value: ''
	} satisfies ChatInputArgs

	const submittingArgs = {
		isSubmitting: true,
		onsubmit,
		value: 'Tell me about the Ashen Crown.'
	} satisfies ChatInputArgs

	const { Story } = defineMeta({
		title: 'Components/ChatInput',
		component: ChatInput,
		tags: ['autodocs'],
		parameters: {
			backgrounds: {
				default: 'parchment',
				values: [{ name: 'parchment', value: '#eee0c6' }]
			}
		}
	})
</script>

<Story name="Default" args={defaultArgs} />

<Story name="Submitting" args={submittingArgs} />
