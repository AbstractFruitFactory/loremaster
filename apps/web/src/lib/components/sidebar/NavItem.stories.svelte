<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import NavItem from './NavItem.svelte'

	type NavItemArgs = ComponentProps<typeof NavItem>

	const defaultArgs = {
		label: 'Campaigns',
		href: '/campaigns',
		icon: 'lucide:book-open'
	} satisfies NavItemArgs

	const activeArgs = {
		label: 'Campaigns',
		href: '/campaigns',
		icon: 'lucide:book-open',
		active: true
	} satisfies NavItemArgs

	const inertArgs = {
		label: 'Worlds',
		icon: 'lucide:globe-2'
	} satisfies NavItemArgs

	const { Story } = defineMeta({
		title: 'Components/Sidebar/NavItem',
		component: NavItem,
		tags: ['autodocs'],
		parameters: {
			backgrounds: {
				default: 'sidebar',
				values: [{ name: 'sidebar', value: '#111a20' }]
			}
		}
	})
</script>

<Story name="Default" args={defaultArgs} />

<Story name="Active" args={activeArgs} />

<Story name="Inert" args={inertArgs} />
