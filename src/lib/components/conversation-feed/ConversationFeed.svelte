<script module lang="ts">
	import type {
		LoreProposalCategoryOption,
		LoreProposalDraft
	} from '#lib/components/lore-proposal/LoreProposal.svelte'
	import type { DocumentType } from '#lib/document.js'

	export type ConversationSource = {
		id: string
		title: string
		type: DocumentType
	}

	export type ConversationMessage = {
		id: string
		role: 'user' | 'assistant'
		content: string
		sources: readonly ConversationSource[]
	}

	export type ConversationProposal = {
		messageId: string
		draft: LoreProposalDraft
	}
</script>

<script lang="ts">
	import LoreProposal from '#lib/components/lore-proposal/LoreProposal.svelte'
	import type { Attachment } from 'svelte/attachments'

	const sourceTypeLabels: Record<DocumentType, string> = {
		player: 'Player',
		npc: 'NPC',
		location: 'Location',
		session: 'Session',
		item: 'Item',
		lore: 'Lore',
		event: 'Event'
	}
	const autoScrollThreshold = 48

	let {
		messages,
		isResponding = false,
		proposal,
		proposalCategoryOptions,
		isProposalSubmitting = false,
		proposalError = '',
		onproposalsave,
		onproposalcancel
	}: {
		messages: readonly ConversationMessage[]
		isResponding?: boolean
		proposal: ConversationProposal | null
		proposalCategoryOptions: readonly LoreProposalCategoryOption[]
		isProposalSubmitting?: boolean
		proposalError?: string
		onproposalsave: (draft: LoreProposalDraft) => void | Promise<void>
		onproposalcancel: () => void
	} = $props()

	const scrollFeed: Attachment<HTMLDivElement> = (feedElement) => {
		let shouldAutoScroll = true
		const updateAutoScroll = () => {
			const distanceFromBottom =
				feedElement.scrollHeight - feedElement.scrollTop - feedElement.clientHeight
			shouldAutoScroll = distanceFromBottom <= autoScrollThreshold
		}

		feedElement.addEventListener('scroll', updateAutoScroll, { passive: true })

		$effect(() => {
			const lastMessage = messages[messages.length - 1]
			messages.length
			lastMessage?.content
			lastMessage?.sources.length
			isResponding
			proposal?.messageId

			if (shouldAutoScroll) {
				feedElement.scrollTop = feedElement.scrollHeight
			}
		})

		return () => feedElement.removeEventListener('scroll', updateAutoScroll)
	}
</script>

<div class="message-feed" aria-live="polite" aria-busy={isResponding} {@attach scrollFeed}>
	{#if messages.length === 0}
		<div class="welcome">
			<p class="welcome-mark" aria-hidden="true">✦</p>
			<div>
				<h3>Shape your world through conversation</h3>
				<p>
					Ask questions, explore connections, or establish and change lore. You will review any
					proposed canon before adding it.
				</p>
			</div>
		</div>
	{:else}
		<ol class="messages">
			{#each messages as conversationMessage, index (conversationMessage.id)}
				{@const isPending =
					isResponding &&
					index === messages.length - 1 &&
					conversationMessage.role === 'assistant' &&
					!conversationMessage.content}
				<li class={[conversationMessage.role, isPending && 'pending']}>
					<p class="speaker">
						{conversationMessage.role === 'user' ? 'You' : 'Loremaster'}
					</p>
					<div class="message-content">
						{#if isPending}
							<p role="status">Considering your campaign…</p>
						{:else}
							{conversationMessage.content}
						{/if}
					</div>
					{#if conversationMessage.sources.length}
						<div class="sources" aria-label="Answer sources">
							<span class="sources-label">Sources</span>
							{#each conversationMessage.sources as source (source.id)}
								<span class="source-chip">
									<span>{source.title}</span>
									<small>{sourceTypeLabels[source.type]}</small>
								</span>
							{/each}
						</div>
					{/if}
				</li>
				{#if proposal?.messageId === conversationMessage.id}
					{#key proposal}
						<li class="assistant proposal-message">
							<p class="speaker">Loremaster</p>
							<LoreProposal
								proposal={proposal.draft}
								categoryOptions={proposalCategoryOptions}
								isSubmitting={isProposalSubmitting}
								error={proposalError}
								onsave={onproposalsave}
								oncancel={onproposalcancel}
							/>
						</li>
					{/key}
				{/if}
			{/each}
		</ol>
	{/if}
</div>

<style>
	h3,
	p {
		margin-top: 0;
	}

	h3 {
		margin-bottom: 0;
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.15;
	}

	.message-feed {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}

	.welcome {
		box-sizing: border-box;
		display: flex;
		gap: var(--spacing-md);
		align-items: center;
		height: 100%;
		max-width: 38rem;
		min-height: 0;
		margin: 0 auto;
		padding: 1.5rem;
		color: #685f51;
	}

	.welcome h3 {
		margin-bottom: 0.35rem;
		color: #403421;
	}

	.welcome p:last-child {
		margin-bottom: 0;
	}

	.welcome-mark {
		display: grid;
		flex: 0 0 auto;
		width: 2.5rem;
		height: 2.5rem;
		margin-bottom: 0;
		place-items: center;
		border: 1px solid #b39256;
		border-radius: 50%;
		background: rgb(244 230 199 / 72%);
		color: #8a682f;
		font-size: 1rem;
	}

	.messages {
		display: grid;
		gap: var(--spacing-md);
		margin: 0;
		padding: 1.25rem 1.5rem 1.5rem;
		list-style: none;
	}

	.messages > li {
		width: fit-content;
		max-width: min(86%, 45rem);
		padding: 0.8rem 1rem;
		border-radius: var(--border-radius-lg);
		box-shadow: 0 0.2rem 0.7rem rgb(55 38 17 / 7%);
	}

	.messages > .user {
		justify-self: end;
		border: 1px solid #4e5946;
		border-bottom-right-radius: var(--border-radius-sm);
		background: #44513f;
		color: #fffdf7;
	}

	.messages > .assistant {
		justify-self: start;
		border: 1px solid #c7ad7d;
		border-bottom-left-radius: var(--border-radius-sm);
		background: rgb(255 253 247 / 86%);
		color: #342e25;
	}

	.messages > .proposal-message {
		box-sizing: border-box;
		width: min(100%, 52rem);
		max-width: 100%;
		padding: 1rem 1.15rem 1.15rem;
	}

	.messages > .pending {
		color: #716552;
		font-style: italic;
	}

	.messages p:last-child {
		margin-bottom: 0;
	}

	.speaker {
		margin-bottom: 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.message-content {
		line-height: 1.55;
		white-space: pre-wrap;
	}

	.sources {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.75rem;
		padding-top: 0.65rem;
		border-top: 1px solid rgb(142 114 69 / 28%);
	}

	.sources-label {
		margin-right: 0.1rem;
		color: #786b58;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.source-chip {
		display: inline-flex;
		gap: 0.4rem;
		align-items: baseline;
		padding: 0.22rem 0.5rem;
		border: 1px solid #c2a875;
		border-radius: var(--border-radius-full);
		background: #f4ead3;
		color: #4b3c27;
		font-size: 0.78rem;
		line-height: 1.2;
	}

	.source-chip small {
		color: #796a54;
		font-size: 0.66rem;
		letter-spacing: 0.03em;
	}

	@media (max-width: 44rem) {
		.messages {
			padding-right: var(--spacing-md);
			padding-left: var(--spacing-md);
		}

		.messages > li {
			max-width: 94%;
		}
	}

	@media (max-width: 30rem) {
		.welcome {
			align-items: flex-start;
			padding: var(--spacing-md);
		}
	}
</style>
