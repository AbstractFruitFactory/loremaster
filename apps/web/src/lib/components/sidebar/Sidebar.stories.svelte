<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'

	import Sidebar from './Sidebar.svelte'

	type SidebarArgs = ComponentProps<typeof Sidebar>

	const items = [
		{ label: 'Home', href: '/', icon: 'lucide:house' },
		{ label: 'Campaigns', href: '/campaigns', icon: 'lucide:book-open' },
		{ label: 'Templates', href: '/templates', icon: 'lucide:layout-template' },
		{ label: 'Import', href: '/import', icon: 'lucide:upload' }
	] as const

	const campaignsArgs = {
		items,
		activePath: '/campaigns'
	} satisfies SidebarArgs

	const { Story } = defineMeta({
		title: 'Components/Sidebar/Sidebar',
		component: Sidebar,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen',
			backgrounds: {
				default: 'neutral',
				values: [{ name: 'neutral', value: '#e7e1d5' }]
			}
		}
	})
</script>

<Story name="Campaigns active" args={campaignsArgs} />
