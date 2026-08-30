<script lang="ts">
	import Button from '#lib/components/button/Button.svelte'
	import type { DocumentType } from '#lib/document.js'
	import { getCampaign } from '../../data.remote'
	import type { PageProps } from './$types'
	import { askLoremaster, createLore, getLore, listLore } from './data.remote'

	type Category = DocumentType
	type CategoryFilter = Category | 'all'
	type LoreEntry = Awaited<ReturnType<typeof getLore>>
	type Source = Awaited<ReturnType<typeof askLoremaster>>['sources'][number]
	type ConversationMessage = {
		id: string
		role: 'user' | 'assistant'
		content: string
		sources: Source[]
	}
	type Proposal = {
		title: string
		category: Category
		content: string
	}

	const categories: Array<{ value: CategoryFilter; label: string }> = [
		{ value: 'all', label: 'All lore' },
		{ value: 'player', label: 'Players' },
		{ value: 'npc', label: 'NPCs' },
		{ value: 'location', label: 'Locations' },
		{ value: 'session', label: 'Sessions' },
		{ value: 'item', label: 'Items' },
		{ value: 'lore', label: 'Lore' },
		{ value: 'event', label: 'Events' }
	]

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)
	const campaign = $derived(getCampaign(campaignId))
	const lore = $derived(listLore(campaignId))

	let search = $state('')
	let category = $state<CategoryFilter>('all')
	let selectedLore = $state.raw<LoreEntry | null>(null)
	let messages = $state.raw<ConversationMessage[]>([])
	let proposal = $state<Proposal | null>(null)
	let message = $state('')
	let openingLoreId = $state<string | null>(null)
	let isResponding = $state(false)
	let isAddingLore = $state(false)
	let statusMessage = $state('')
	let actionError = $state('')
	let proposalError = $state('')

	const filteredLore = $derived.by(() => {
		const normalizedSearch = search.trim().toLocaleLowerCase()

		return (lore.current ?? []).filter(
			(entry) =>
				(category === 'all' || entry.category === category) &&
				(!normalizedSearch || entry.title.toLocaleLowerCase().includes(normalizedSearch))
		)
	})

	const getErrorMessage = (error: unknown, fallback: string) =>
		error instanceof Error ? error.message : fallback

	const createMessageId = () => crypto.randomUUID()

	const openLore = async (loreId: string) => {
		openingLoreId = loreId
		actionError = ''

		try {
			selectedLore = await getLore({ campaignId, loreId })
		} catch (error) {
			actionError = getErrorMessage(error, 'Unable to open this lore entry')
		} finally {
			openingLoreId = null
		}
	}

	const handleAsk = async (event: SubmitEvent) => {
		event.preventDefault()
		const submittedMessage = message.trim()
		if (!submittedMessage || isResponding) return

		const history = messages.slice(-12).map(({ role, content }) => ({ role, content }))
		messages = [
			...messages,
			{ id: createMessageId(), role: 'user', content: submittedMessage, sources: [] }
		]
		message = ''
		isResponding = true
		statusMessage = ''
		actionError = ''
		proposalError = ''

		try {
			const response = await askLoremaster({
				campaignId,
				message: submittedMessage,
				history
			})
			messages = [
				...messages,
				{
					id: createMessageId(),
					role: 'assistant',
					content: response.message,
					sources: response.sources
				}
			]

			if (response.proposal) {
				proposal = {
					title: response.proposal.title,
					category: response.proposal.category,
					content: response.proposal.content
				}
			}
		} catch (error) {
			actionError = getErrorMessage(error, 'Loremaster could not respond')
		} finally {
			isResponding = false
		}
	}

	const handleAddLore = async (event: SubmitEvent) => {
		event.preventDefault()
		if (!proposal || isAddingLore) return

		const title = proposal.title.trim()
		const content = proposal.content.trim()
		if (!title) {
			proposalError = 'Give this lore entry a title before adding it.'
			return
		}

		if (!content) {
			proposalError = 'Add some lore content before saving.'
			return
		}

		isAddingLore = true
		proposalError = ''
		actionError = ''
		statusMessage = ''

		try {
			const createdLore = await createLore({
				campaignId,
				title,
				category: proposal.category,
				content
			})
			selectedLore = createdLore
			proposal = null
			statusMessage = `Added “${createdLore.title}” to your lore.`
		} catch (error) {
			proposalError = getErrorMessage(error, 'Unable to add this lore entry')
		} finally {
			isAddingLore = false
		}
	}

	const cancelProposal = () => {
		proposal = null
		proposalError = ''
	}
</script>

<svelte:head>
	<title>{campaign.current?.name ?? 'Campaign'} | Loremaster</title>
	<meta name="description" content="Explore campaign lore and collaborate with Loremaster." />
</svelte:head>

<main>
	<header class="campaign-header">
		<a href="/">← Campaigns</a>
		<div>
			<p class="eyebrow">Loremaster workspace</p>
			<h1>{campaign.current?.name ?? 'Campaign'}</h1>
			{#if campaign.current?.description}
				<p class="campaign-description">{campaign.current.description}</p>
			{/if}
		</div>
	</header>

	{#if campaign.error}
		<p class="page-error" role="alert">Unable to load this campaign.</p>
	{/if}

	<div class="announcements" aria-live="polite" aria-atomic="true">
		{#if statusMessage}
			<p class="success">{statusMessage}</p>
		{/if}
		{#if actionError}
			<p class="error" role="alert">{actionError}</p>
		{/if}
	</div>

	<div class="workspace">
		<aside class="library" aria-labelledby="library-heading">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">Campaign knowledge</p>
					<h2 id="library-heading">Lore library</h2>
				</div>
				{#if lore.current}
					<span class="count">{filteredLore.length}</span>
				{/if}
			</div>

			<label>
				Search lore
				<input type="search" bind:value={search} placeholder="Search by title" autocomplete="off" />
			</label>

			<label>
				Category
				<select bind:value={category}>
					{#each categories as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>

			<div class="library-results">
				{#if lore.error}
					<p class="error" role="alert">Unable to load campaign lore.</p>
				{:else if lore.loading && !lore.current}
					<p role="status">Loading lore…</p>
				{:else if filteredLore.length}
					<ul class="lore-list">
						{#each filteredLore as entry (entry.id)}
							<li>
								<Button
									variant="secondary"
									disabled={openingLoreId !== null}
									aria-pressed={selectedLore?.id === entry.id}
									onclick={() => openLore(entry.id)}
								>
									{openingLoreId === entry.id ? 'Opening…' : entry.title}
								</Button>
							</li>
						{/each}
					</ul>
				{:else if lore.current?.length}
					<p>No lore matches these filters.</p>
				{:else}
					<p>No lore yet. Ask Loremaster to help create your first entry.</p>
				{/if}
			</div>
		</aside>

		<section class="conversation" aria-labelledby="conversation-heading">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">Creative companion</p>
					<h2 id="conversation-heading">Ask Loremaster</h2>
				</div>
				<span class="presence">Ready</span>
			</div>

			<div class="message-feed" aria-live="polite">
				{#if messages.length === 0}
					<div class="welcome">
						<p class="welcome-mark" aria-hidden="true">✦</p>
						<h3>Shape your world through conversation</h3>
						<p>
							Ask questions, explore connections, or naturally establish and change lore. You will
							review any proposed canon before adding it.
						</p>
					</div>
				{:else}
					<ol class="messages">
						{#each messages as conversationMessage (conversationMessage.id)}
							<li class={conversationMessage.role}>
								<p class="speaker">
									{conversationMessage.role === 'user' ? 'You' : 'Loremaster'}
								</p>
								<div class="message-content">{conversationMessage.content}</div>
								{#if conversationMessage.sources.length}
									<div class="sources" aria-label="Answer sources">
										<span>Sources</span>
										{#each conversationMessage.sources as source (source.id)}
											<Button
												variant="secondary"
												disabled={openingLoreId !== null}
												onclick={() => openLore(source.id)}
											>
												{source.title}
											</Button>
										{/each}
									</div>
								{/if}
							</li>
						{/each}
						{#if isResponding}
							<li class="assistant pending" role="status">
								<p class="speaker">Loremaster</p>
								<p>Considering your campaign…</p>
							</li>
						{/if}
					</ol>
				{/if}
			</div>

			{#if proposal}
				<form class="proposal" onsubmit={handleAddLore} aria-labelledby="proposal-heading">
					<div class="proposal-heading">
						<div>
							<p class="eyebrow">Review before adding</p>
							<h3 id="proposal-heading">Lore proposal</h3>
						</div>
						<span>Draft</span>
					</div>

					<div class="proposal-fields">
						<label>
							Title
							<input
								bind:value={proposal.title}
								required
								maxlength="200"
								autocomplete="off"
								placeholder="Name this lore entry"
							/>
						</label>
						<label>
							Category
							<select bind:value={proposal.category}>
								{#each categories.slice(1) as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</label>
					</div>

					<label>
						Content
						<textarea bind:value={proposal.content} required rows="8"></textarea>
					</label>

					{#if proposalError}
						<p class="error proposal-error" role="alert">{proposalError}</p>
					{/if}

					<div class="proposal-actions">
						<Button type="submit" disabled={isAddingLore}>
							{isAddingLore ? 'Adding…' : 'Add to lore'}
						</Button>
						<Button
							type="button"
							variant="secondary"
							onclick={cancelProposal}
							disabled={isAddingLore}
						>
							Cancel
						</Button>
					</div>
				</form>
			{/if}

			<form class="composer" onsubmit={handleAsk}>
				<label class="message-label" for="loremaster-message">
					Ask a question or shape your lore
				</label>
				<textarea
					id="loremaster-message"
					bind:value={message}
					required
					maxlength="2000"
					rows="4"
					disabled={isResponding}
					placeholder="Ask about your world, or describe lore to establish or change…"></textarea>
				<div class="composer-actions">
					<span>{message.length}/2000</span>
					<Button type="submit" disabled={isResponding || !message.trim()}>
						{isResponding ? 'Thinking…' : 'Send to Loremaster'}
					</Button>
				</div>
			</form>
		</section>

		<aside class="context" aria-labelledby="context-heading" aria-busy={openingLoreId !== null}>
			<p class="eyebrow">Current context</p>
			{#if selectedLore}
				<div class="context-heading">
					<span class="category">{selectedLore.category}</span>
					<h2 id="context-heading">{selectedLore.title}</h2>
				</div>
				<div class="lore-content">{selectedLore.content}</div>
			{:else}
				<div class="empty-context">
					<p class="context-mark" aria-hidden="true">◎</p>
					<h2 id="context-heading">Lore appears here</h2>
					<p>
						Select an entry from the library or an answer source to keep its details beside your
						conversation.
					</p>
				</div>
			{/if}
		</aside>
	</div>
</main>

<style>
	main {
		width: min(96rem, calc(100% - 2rem));
		margin: 0 auto;
		padding: var(--spacing-lg) 0 var(--spacing-2xl);
	}

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: var(--spacing-xs);
		font-size: clamp(1.7rem, 4vw, 2.5rem);
		line-height: 1.1;
	}

	h2,
	h3 {
		margin-bottom: 0;
	}

	h2 {
		font-size: 1.15rem;
	}

	h3 {
		font-size: 1rem;
	}

	.campaign-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--spacing-lg);
		align-items: start;
		margin-bottom: var(--spacing-md);
	}

	.campaign-header > a {
		margin-top: 0.3rem;
		color: var(--color-main);
		font-weight: 700;
		text-decoration: none;
	}

	.campaign-header > a:hover {
		text-decoration: underline;
	}

	.campaign-description {
		max-width: 52rem;
		margin-bottom: 0;
		color: var(--color-muted);
	}

	.eyebrow {
		margin-bottom: var(--spacing-xs);
		color: var(--color-muted);
		font-size: 0.7rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.announcements {
		min-height: 1.75rem;
	}

	.announcements p,
	.page-error {
		margin-bottom: var(--spacing-sm);
		font-weight: 650;
	}

	.success {
		color: #35652f;
	}

	.error,
	.page-error {
		color: #a12727;
	}

	.workspace {
		display: grid;
		grid-template-areas: 'library conversation context';
		grid-template-columns: minmax(14rem, 19rem) minmax(27rem, 1fr) minmax(16rem, 22rem);
		min-height: 46rem;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.library,
	.context,
	.conversation {
		min-width: 0;
		padding: var(--spacing-lg);
	}

	.library {
		grid-area: library;
		border-right: 1px solid var(--color-border);
		background: #faf9f6;
	}

	.conversation {
		display: flex;
		grid-area: conversation;
		flex-direction: column;
		padding-bottom: var(--spacing-md);
	}

	.context {
		grid-area: context;
		border-left: 1px solid var(--color-border);
		background: #faf9f6;
	}

	.panel-heading,
	.proposal-heading {
		display: flex;
		justify-content: space-between;
		gap: var(--spacing-md);
		align-items: start;
	}

	.panel-heading {
		margin-bottom: var(--spacing-lg);
	}

	.count,
	.presence,
	.proposal-heading > span,
	.category {
		padding: 0.2rem 0.55rem;
		border-radius: var(--border-radius-full);
		font-size: 0.73rem;
		font-weight: 750;
	}

	.count {
		background: #e5e2db;
	}

	.presence {
		background: #e6efe2;
		color: #35652f;
	}

	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.86rem;
		font-weight: 650;
	}

	.library > label + label {
		margin-top: var(--spacing-sm);
	}

	input,
	select,
	textarea {
		width: 100%;
		padding: 0.65rem 0.75rem;
		border: 1px solid #aaa298;
		border-radius: var(--border-radius-md);
		background: var(--color-surface);
	}

	textarea {
		resize: vertical;
		line-height: 1.55;
	}

	.library-results {
		margin-top: var(--spacing-lg);
		color: var(--color-muted);
	}

	.lore-list,
	.messages {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.lore-list {
		display: grid;
		gap: 0.35rem;
	}

	.lore-list :global(button.button) {
		width: 100%;
		justify-content: flex-start;
		overflow: hidden;
		border-color: transparent;
		background: transparent;
		box-shadow: none;
		color: var(--color-text);
		text-align: left;
		text-overflow: ellipsis;
		filter: none;
		transform: none;
	}

	.lore-list :global(button.button:hover:not(:disabled)),
	.lore-list :global(button.button[aria-pressed='true']) {
		border-color: #aeb7a9;
		background: #e9eee6;
		box-shadow: none;
		filter: none;
		transform: none;
	}

	.message-feed {
		flex: 1;
		min-height: 20rem;
	}

	.welcome {
		display: grid;
		min-height: 23rem;
		place-content: center;
		justify-items: center;
		max-width: 34rem;
		margin: 0 auto;
		color: var(--color-muted);
		text-align: center;
	}

	.welcome h3 {
		margin-bottom: var(--spacing-sm);
		color: var(--color-text);
		font-size: 1.25rem;
	}

	.welcome p:last-child,
	.empty-context p:last-child {
		margin-bottom: 0;
	}

	.welcome-mark,
	.context-mark {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		margin-bottom: var(--spacing-md);
		place-items: center;
		border: 1px solid #aeb7a9;
		border-radius: var(--border-radius-full);
		background: #eef2ec;
		color: var(--color-main);
		font-size: 1.25rem;
	}

	.messages {
		display: grid;
		gap: var(--spacing-md);
		padding-bottom: var(--spacing-lg);
	}

	.messages > li {
		max-width: 85%;
		padding: var(--spacing-md);
		border-radius: var(--border-radius-lg);
	}

	.messages > .user {
		justify-self: end;
		background: var(--color-main);
		color: var(--color-surface);
	}

	.messages > .assistant {
		justify-self: start;
		border: 1px solid var(--color-border);
		background: #faf9f6;
	}

	.messages > .pending {
		color: var(--color-muted);
	}

	.messages p:last-child {
		margin-bottom: 0;
	}

	.speaker {
		margin-bottom: var(--spacing-xs);
		font-size: 0.73rem;
		font-weight: 750;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.message-content,
	.lore-content {
		white-space: pre-wrap;
	}

	.sources {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		align-items: center;
		margin-top: var(--spacing-md);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
	}

	.sources > span {
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 750;
		text-transform: uppercase;
	}

	.sources :global(button.button) {
		padding: 0.3rem 0.55rem;
		font-size: 0.78rem;
	}

	.proposal {
		display: grid;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
		padding: var(--spacing-lg);
		border: 1px solid #aeb7a9;
		border-radius: var(--border-radius-lg);
		background: #f5f8f3;
		box-shadow: var(--shadow-sm);
	}

	.proposal-heading > span {
		background: #dfe8db;
		color: #42513c;
	}

	.proposal-fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(9rem, 0.4fr);
		gap: var(--spacing-md);
	}

	.proposal-error {
		margin-bottom: 0;
	}

	.proposal-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.composer {
		display: grid;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border);
	}

	.message-label {
		margin-bottom: 0.35rem;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.composer-actions {
		display: flex;
		justify-content: space-between;
		gap: var(--spacing-md);
		align-items: center;
	}

	.composer-actions > span {
		color: var(--color-muted);
		font-size: 0.75rem;
	}

	.context-heading {
		margin-bottom: var(--spacing-lg);
	}

	.category {
		display: inline-block;
		margin-bottom: var(--spacing-sm);
		background: #e5e2db;
		color: var(--color-muted);
		text-transform: capitalize;
	}

	.lore-content {
		color: #393630;
		line-height: 1.75;
	}

	.empty-context {
		display: grid;
		min-height: 26rem;
		place-content: center;
		justify-items: center;
		color: var(--color-muted);
		text-align: center;
	}

	.empty-context h2 {
		margin-bottom: var(--spacing-sm);
		color: var(--color-text);
	}

	@media (max-width: 72rem) {
		.workspace {
			grid-template-areas:
				'library library'
				'conversation context';
			grid-template-columns: minmax(27rem, 1fr) minmax(16rem, 21rem);
		}

		.library {
			border-right: 0;
			border-bottom: 1px solid var(--color-border);
		}

		.library-results {
			max-height: 14rem;
			overflow-y: auto;
		}
	}

	@media (max-width: 48rem) {
		main {
			width: min(100% - 1rem, 42rem);
			padding-top: var(--spacing-md);
		}

		.campaign-header {
			grid-template-columns: 1fr;
			gap: var(--spacing-sm);
		}

		.workspace {
			display: flex;
			flex-direction: column;
			overflow: visible;
		}

		.library,
		.context {
			border: 0;
			border-bottom: 1px solid var(--color-border);
		}

		.context {
			border-top: 1px solid var(--color-border);
		}

		.message-feed,
		.welcome,
		.empty-context {
			min-height: 16rem;
		}

		.proposal-fields {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 30rem) {
		.library,
		.context,
		.conversation,
		.proposal {
			padding: var(--spacing-md);
		}

		.messages > li {
			max-width: 95%;
		}

		.proposal-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.composer-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.composer-actions > span {
			align-self: flex-end;
		}
	}
</style>
