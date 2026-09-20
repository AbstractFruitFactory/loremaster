<script lang="ts">
	import { page } from '$app/state'
	import Icon from '@iconify/svelte'
	import { streamAssistant } from '#lib/assistant-stream.js'
	import logo from '#lib/assets/logo-eye.png'
	import ChatDock from '#lib/components/chat-dock/ChatDock.svelte'
	import type {
		AddLoreInput,
		AskLoremasterInput,
		ChatDockMode
	} from '#lib/components/chat-dock/ChatDock.svelte'
	import Header from '#lib/components/header/Header.svelte'
	import NavItem from '#lib/components/sidebar/NavItem.svelte'
	import { documentTypes } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import { getConversationHistory } from './conversation.remote'
	import { createLore } from './data.remote'
	import { getCampaign } from '../../data.remote'
	import type { LayoutProps } from './$types'

	let { data, params, children }: LayoutProps = $props()

	const campaignId = $derived(params.campaignId)
	const campaign = $derived(getCampaign(campaignId))
	const conversation = $derived(getConversationHistory(campaignId))
	const navigationItems = $derived(
		documentTypes.map((type) => ({
			...documentTypeMetadata[type],
			href: `/campaigns/${campaignId}/${type}`
		}))
	)

	let chatMode = $state<ChatDockMode>('sidebar')
	const isChatExpanded = $derived(chatMode === 'expanded')

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

{#snippet accountActions()}
	{#if data.user}
		<div class="account">
			<span>{data.user.email}</span>
			{#if data.isAdmin}
				<a href="/admin/invites">Invite</a>
			{/if}
			<form method="POST" action="/logout">
				<button>Sign out</button>
			</form>
		</div>
	{/if}
{/snippet}

{#snippet navigation()}
	<div class="campaign-navigation">
		<nav aria-label="Campaign sections">
			<ul>
				{#each navigationItems as item (item.label)}
					<li>
						<NavItem {...item} variant="tab" active={page.url.pathname.startsWith(item.href)} />
					</li>
				{/each}
			</ul>
		</nav>
		{#if chatMode === 'hidden'}
			<button
				id="campaign-chat-toggle"
				class="chat-toggle"
				type="button"
				aria-controls="campaign-chat-panel"
				aria-expanded="false"
				aria-label="Open Ask Loremaster"
				onclick={() => (chatMode = 'sidebar')}
			>
				<Icon icon="lucide:message-circle" aria-hidden="true" />
				<span>Chat</span>
			</button>
		{/if}
	</div>
{/snippet}

<div
	class={[
		'campaign-shell',
		chatMode === 'sidebar' && 'chat-sidebar',
		isChatExpanded && 'chat-expanded'
	]}
>
	<div class="campaign-workspace" inert={isChatExpanded}>
		<Header {brand} {navigation} actions={accountActions}>
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
				{campaignId}
				id="campaign-chat-panel"
				toggleId="campaign-chat-toggle"
				bind:mode={chatMode}
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
		--chat-resize-duration: 180ms;
		--chat-resize-easing: ease;
		--campaign-inline-padding: clamp(1.25rem, 3vw, 2.75rem);

		position: relative;
		width: 100%;
		height: 100%;
		padding: var(--workspace-gap);
		overflow: hidden;
		background: transparent;
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
		transition: margin-right var(--chat-resize-duration) var(--chat-resize-easing);
	}

	.campaign-shell.chat-sidebar .campaign-workspace {
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
		color: #000;
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

	.account {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.4rem 0.35rem 0.7rem;
		border: 1px solid rgb(37 35 31 / 28%);
		border-radius: 999px;
		background: rgb(255 250 240 / 92%);
		box-shadow: 0 2px 8px rgb(37 35 31 / 12%);
		color: var(--color-text);
		font-family: var(--font-sans);
		font-size: 0.78rem;
	}

	.account form {
		display: contents;
	}

	.account button {
		padding: 0.3rem 0.6rem;
		border: 0;
		border-radius: 999px;
		background: var(--color-main);
		color: #fffaf0;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.account a {
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		color: var(--color-main);
		font-weight: 700;
		text-decoration: none;
	}

	.account a:hover {
		background: rgb(62 75 57 / 10%);
	}

	.account button:focus-visible,
	.account a:focus-visible {
		outline: 3px solid rgb(62 75 57 / 35%);
		outline-offset: 2px;
	}

	ul {
		margin: 0;
		padding: 0;
	}

	.campaign-navigation {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.75rem;
	}

	.campaign-navigation nav {
		min-width: 0;
		flex: 1;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.campaign-navigation nav::-webkit-scrollbar {
		display: none;
	}

	ul {
		display: flex;
		gap: 0.42rem;
		list-style: none;
	}

	.chat-toggle {
		box-sizing: border-box;
		display: inline-flex;
		height: 42px;
		flex: 0 0 auto;
		align-items: center;
		gap: 8px;
		padding: 5px 13px 5px 6px;
		border: 1px solid #c98b3d;
		border-radius: 8px;
		background: linear-gradient(90deg, #e9bf75, #fff8e9);
		box-shadow: 0 2px 5px rgb(73 45 28 / 18%);
		color: #37241d;
		font-family: var(--font-sans);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			box-shadow 150ms ease,
			transform 150ms ease;
	}

	.chat-toggle:hover {
		border-color: #a86e2d;
		background: linear-gradient(90deg, #f2c982, #fffaf0);
		box-shadow: 0 3px 7px rgb(73 45 28 / 24%);
		transform: translateY(-1px);
	}

	.chat-toggle :global(svg) {
		width: 1.15rem;
		height: 1.15rem;
		color: #7b5d2d;
	}

	.chat-toggle:focus-visible {
		border-color: #a86e2d;
		outline: 2px solid #efd290;
		outline-offset: 3px;
		box-shadow: 0 0 0 4px rgb(11 18 22 / 80%);
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
	}

	@media (max-width: 72rem) {
		.campaign-shell.chat-sidebar .campaign-workspace {
			margin-right: 0;
		}
	}

	@media (max-width: 42rem) {
		.brand span {
			display: none;
		}

		.account span {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.campaign-workspace {
			transition: none;
		}
	}
</style>
