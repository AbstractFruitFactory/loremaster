<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Icon from '@iconify/svelte'
	import type { ComponentProps } from 'svelte'

	import Button from './Button.svelte'

	type ButtonArgs = ComponentProps<typeof Button>

	const primaryArgs = {
		type: 'button',
		variant: 'primary'
	} satisfies Partial<ButtonArgs>

	const secondaryArgs = {
		type: 'button',
		variant: 'secondary'
	} satisfies Partial<ButtonArgs>

	const dangerArgs = {
		type: 'button',
		variant: 'danger'
	} satisfies Partial<ButtonArgs>

	const disabledArgs = {
		type: 'button',
		variant: 'primary',
		disabled: true
	} satisfies Partial<ButtonArgs>

	const { Story } = defineMeta({
		title: 'Components/Button',
		component: Button,
		tags: ['autodocs']
	})
</script>

{#snippet sparkleIcon()}
	<Icon icon="lucide:sparkles" width="1.15rem" height="1.15rem" />
{/snippet}

<Story name="Primary" args={primaryArgs}>Primary button</Story>

<Story name="Secondary" args={secondaryArgs}>Secondary button</Story>

<Story name="Danger" args={dangerArgs}>Danger button</Story>

<Story name="Disabled" args={disabledArgs}>Disabled button</Story>

<Story name="Split seal" args={{ ...primaryArgs, icon: sparkleIcon }}>Ask Loremaster</Story>
