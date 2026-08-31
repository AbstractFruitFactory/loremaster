<script lang="ts">
	import paperBackground from '#lib/assets/page-background.webp'
	import Header from '#lib/components/header/Header.svelte'
	import Sidebar from '#lib/components/sidebar/Sidebar.svelte'
	import { documentTypes, type DocumentType } from '#lib/document.js'
	import { getCampaign } from '../../data.remote'
	import type { LayoutProps } from './$types'

	const documentTypeMetadata = {
		player: { label: 'Players', icon: 'lucide:users' },
		npc: { label: 'NPCs', icon: 'lucide:user-round' },
		location: { label: 'Locations', icon: 'lucide:map-pin' },
		session: { label: 'Sessions', icon: 'lucide:calendar-days' },
		item: { label: 'Items', icon: 'lucide:package' },
		lore: { label: 'Lore', icon: 'lucide:book-open' },
		event: { label: 'Events', icon: 'lucide:milestone' }
	} satisfies Record<DocumentType, { label: string; icon: string }>

	const sidebarItems = documentTypes.map((type) => documentTypeMetadata[type])

	let { params, children }: LayoutProps = $props()

	const campaignId = $derived(params.campaignId)
	const campaign = $derived(getCampaign(campaignId))
</script>

<svelte:head>
	<title>{campaign.current?.name ?? 'Campaign'} | Loremaster</title>
	<meta name="description" content="Explore campaign lore and collaborate with Loremaster." />
</svelte:head>

{#snippet campaignHeading()}
	<h1 class="campaign-title">{campaign.current?.name ?? 'Campaign'}</h1>
{/snippet}

<div class="campaign-shell">
	<Sidebar items={sidebarItems} />

	<div class="campaign-workspace" style:--paper-background={`url("${paperBackground}")`}>
		<Header>{@render campaignHeading()}</Header>

		<div class="campaign-content">
			{#if campaign.error}
				<p class="campaign-error" role="alert">Unable to load this campaign.</p>
			{/if}

			<div class="route-content">
				{@render children()}
			</div>
		</div>
	</div>
</div>

<style>
	.campaign-shell {
		--sidebar-width: 100%;

		display: grid;
		grid-template-columns: 17.5rem minmax(0, 1fr);
		width: 100%;
		max-width: 100%;
		height: 100dvh;
		overflow: hidden;
	}

	.campaign-workspace,
	.campaign-content,
	.route-content {
		min-width: 0;
	}

	.campaign-workspace {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
		background-color: #eee0c6;
		background-image: var(--paper-background);
		background-repeat: no-repeat;
		background-position: center;
		background-size: 100% 100%;
	}

	.campaign-title {
		margin: 0;
		overflow-wrap: anywhere;
		color: #3b2d1f;
		font-size: clamp(1.35rem, 3vw, 1.8rem);
		letter-spacing: 0.025em;
		line-height: 1.15;
	}

	.campaign-content {
		width: 100%;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.campaign-error {
		margin: 0;
		padding: 0.85rem clamp(1rem, 4vw, 2rem);
		border-bottom: 1px solid #b77b65;
		background: #f5dfd6;
		color: #7e2d20;
		font-family: var(--font-sans);
		font-weight: 650;
	}

	.route-content {
		width: 100%;
	}

	@media (max-width: 52rem) {
		.campaign-shell {
			--sidebar-min-height: auto;

			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}

		.campaign-workspace {
			min-height: 0;
		}

		.campaign-content {
			min-height: 0;
		}
	}
</style>
