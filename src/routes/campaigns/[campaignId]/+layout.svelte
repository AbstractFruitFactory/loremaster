<script lang="ts">
	import { page } from '$app/state'
	import Icon from '@iconify/svelte'
	import { streamAssistant } from '#lib/assistant-stream.js'
	import logo from '#lib/assets/logo-eye.png'
	import ChatDock from '#lib/components/chat-dock/ChatDock.svelte'
	import type { AddLoreInput, AskLoremasterInput } from '#lib/components/chat-dock/ChatDock.svelte'
	import Header from '#lib/components/header/Header.svelte'
	import NavItem from '#lib/components/sidebar/NavItem.svelte'
	import { documentTypes } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import { getConversationHistory } from './conversation.remote'
	import { createLore } from './data.remote'
	import { getCampaign } from '../../data.remote'
	import type { LayoutProps } from './$types'

	let { params, children }: LayoutProps = $props()

	const campaignId = $derived(params.campaignId)
	const campaign = $derived(getCampaign(campaignId))
	const conversation = $derived(getConversationHistory(campaignId))
	const navigationItems = $derived(
		documentTypes.map((type) => ({
			...documentTypeMetadata[type],
			href: `/campaigns/${campaignId}/${type}`
		}))
	)

	let isChatOpen = $state(false)

	$effect(() => {
		if (page.url.pathname === `/campaigns/${campaignId}`) isChatOpen = true
	})

	const handleAsk = (input: AskLoremasterInput, signal: AbortSignal) =>
		streamAssistant(campaignId, input, { signal })
	const handleAddLore = (draft: AddLoreInput) => createLore({ campaignId, ...draft })
</script>

<svelte:head>
	<title>{campaign.current?.name ?? 'Campaign'} | Loremaster</title>
	<meta name="description" content="Explore campaign lore and collaborate with Loremaster." />
</svelte:head>

{#snippet brand()}
	<a class="brand" href="/" aria-label="Loremaster campaigns">
		<img src={logo} alt="" />
		<span>Loremaster</span>
	</a>
{/snippet}

{#snippet campaignHeading()}
	<a class="campaign-title" href={`/campaigns/${campaignId}`}>
		{campaign.current?.name ?? 'Campaign'}
	</a>
{/snippet}

{#snippet navigation()}
	<nav aria-label="Campaign sections">
		<ul>
			{#each navigationItems as item (item.label)}
				<li>
					<NavItem {...item} variant="tab" active={page.url.pathname.startsWith(item.href)} />
				</li>
			{/each}
		</ul>
	</nav>
{/snippet}

{#snippet headerActions()}
	<button
		class:active={isChatOpen}
		class="chat-toggle"
		type="button"
		aria-label={isChatOpen ? 'Collapse Ask Loremaster' : 'Open Ask Loremaster'}
		aria-expanded={isChatOpen}
		onclick={() => (isChatOpen = !isChatOpen)}
	>
		<Icon icon="lucide:message-circle" aria-hidden="true" />
		<span>Chat</span>
	</button>
{/snippet}

<div class:chat-open={isChatOpen} class="campaign-shell">
	<div class="campaign-workspace">
		<Header {brand} {navigation} actions={headerActions}>
			{@render campaignHeading()}
		</Header>

		<div class="campaign-content">
			{#if campaign.error}
				<p class="campaign-error" role="alert">Unable to load this campaign.</p>
			{/if}

			<div class="route-content">
				{@render children()}
			</div>
		</div>
	</div>

	{#if conversation.current !== undefined}
		{#key campaignId}
			<ChatDock
				bind:open={isChatOpen}
				conversationHistory={conversation.current}
				onask={handleAsk}
				onaddlore={handleAddLore}
			/>
		{/key}
	{/if}
</div>

<style>
	.campaign-shell {
		--workspace-gap: clamp(0.65rem, 1.5vw, 1rem);
		--chat-panel-width: clamp(25rem, 31vw, 29rem);

		position: relative;
		width: 100%;
		height: 100%;
		padding: var(--workspace-gap);
		overflow: hidden;
		background: radial-gradient(circle at 18% 0%, rgb(81 104 91 / 55%), transparent 28rem), #2b3732;
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
		transition: margin-right 180ms ease;
	}

	.campaign-shell.chat-open .campaign-workspace {
		margin-right: calc(var(--chat-panel-width) + var(--workspace-gap));
	}

	.campaign-title {
		display: block;
		margin: 0;
		overflow-wrap: anywhere;
		color: #f3e8d2;
		font-family: var(--font-display);
		font-size: clamp(1.15rem, 2.3vw, 1.45rem);
		font-weight: 600;
		letter-spacing: 0.025em;
		line-height: 1.15;
		text-decoration: none;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: #d7b46e;
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.brand img {
		width: 2.15rem;
		height: 2.15rem;
		object-fit: contain;
	}

	nav,
	ul {
		margin: 0;
		padding: 0;
	}

	ul {
		display: flex;
		gap: 0.42rem;
		list-style: none;
	}

	.chat-toggle {
		display: inline-flex;
		min-height: 2.2rem;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.65rem;
		border: 1px solid rgb(215 180 110 / 42%);
		border-radius: 0.35rem;
		background: rgb(255 246 225 / 7%);
		color: #e8dcc4;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.chat-toggle:hover,
	.chat-toggle.active {
		border-color: #d7b46e;
		background: rgb(215 180 110 / 18%);
	}

	.chat-toggle :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.campaign-content {
		display: flex;
		width: 100%;
		flex: 1;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
	}

	.campaign-error {
		align-self: center;
		flex: none;
		margin: 0.65rem;
		padding: 0.85rem clamp(1rem, 4vw, 2rem);
		border: 1.5px solid #7e2d20;
		background: #f5dfd6;
		box-shadow: 0.18rem 0.18rem 0 #7e2d20;
		color: #7e2d20;
		font-family: var(--font-sans);
		font-weight: 650;
	}

	.route-content {
		width: 100%;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		padding-bottom: 7rem;
	}

	@media (max-width: 72rem) {
		.campaign-shell.chat-open .campaign-workspace {
			margin-right: 0;
		}
	}

	@media (max-width: 42rem) {
		.brand span,
		.chat-toggle span {
			display: none;
		}

		.chat-toggle {
			width: 2.2rem;
			justify-content: center;
			padding-inline: 0;
		}
	}
</style>
