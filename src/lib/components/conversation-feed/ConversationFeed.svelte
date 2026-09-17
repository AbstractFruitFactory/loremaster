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
	import Icon from '@iconify/svelte'
	import LoreProposal from '#lib/components/lore-proposal/LoreProposal.svelte'
	import type { Attachment } from 'svelte/attachments'
	import { citedSourceNumbers, parseMessageCitations } from './citations'

	const sourceTypeLabels: Record<DocumentType, string> = {
		player: 'Player',
		npc: 'NPC',
		location: 'Location',
		session: 'Session',
		item: 'Item',
		worldbuilding: 'Worldbuilding',
		event: 'Event'
	}
	const autoScrollThreshold = 48

	let {
		campaignId,
		messages,
		isResponding = false,
		proposal,
		proposalCategoryOptions,
		isProposalSubmitting = false,
		proposalError = '',
		onproposalsave,
		onproposalcancel
	}: {
		campaignId?: string
		messages: readonly ConversationMessage[]
		isResponding?: boolean
		proposal: ConversationProposal | null
		proposalCategoryOptions: readonly LoreProposalCategoryOption[]
		isProposalSubmitting?: boolean
		proposalError?: string
		onproposalsave: (draft: LoreProposalDraft) => void | Promise<void>
		onproposalcancel: () => void
	} = $props()

	const sourceHref = (source: ConversationSource) =>
		campaignId
			? `/campaigns/${encodeURIComponent(campaignId)}/${source.type}/${encodeURIComponent(source.id)}`
			: undefined

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
				<p>Ask questions, explore connections, or establish new lore.</p>
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
				{@const citedNumbers = citedSourceNumbers(
					conversationMessage.content,
					conversationMessage.sources
				)}
				{@const citedSources = conversationMessage.sources.filter((_, sourceIndex) =>
					citedNumbers.has(sourceIndex + 1)
				)}
				{@const relatedSources = conversationMessage.sources.filter(
					(_, sourceIndex) => !citedNumbers.has(sourceIndex + 1)
				)}
				<li class={[conversationMessage.role, isPending && 'pending']}>
					<p class="speaker">
						{conversationMessage.role === 'user' ? 'You' : 'Loremaster'}
					</p>
					<div class="message-content">
						{#if isPending}
							<p role="status">Considering your campaign…</p>
						{:else}
							{#each parseMessageCitations(conversationMessage.content, conversationMessage.sources) as segment}
								{#if segment.type === 'text'}
									{segment.value}
								{:else}
									<a
										class="citation"
										href={sourceHref(segment.source)}
										aria-label={`Source ${segment.number}: ${segment.source.title}`}
										title={segment.source.title}>[{segment.number}]</a
									>
								{/if}
							{/each}
						{/if}
					</div>
					{#if conversationMessage.sources.length}
						<details class="sources">
							<summary>
								<span class="sources-label">Sources</span>
								<span class="source-count">{conversationMessage.sources.length}</span>
								{#if citedSources.length}
									<span class="citation-count">{citedSources.length} cited</span>
								{/if}
								<Icon class="source-chevron" icon="lucide:chevron-down" aria-hidden="true" />
							</summary>

							<div class="source-panel">
								{#if citedSources.length}
									<section aria-labelledby={`${conversationMessage.id}-evidence`}>
										<h4 id={`${conversationMessage.id}-evidence`}>Evidence used</h4>
										<ul>
											{#each citedSources as source (source.id)}
												{@const sourceNumber = conversationMessage.sources.indexOf(source) + 1}
												<li>
													<a href={sourceHref(source)}>
														<span class="source-number">[{sourceNumber}]</span>
														<span class="source-title">{source.title}</span>
														<small>{sourceTypeLabels[source.type]}</small>
													</a>
												</li>
											{/each}
										</ul>
									</section>
								{/if}

								{#if relatedSources.length}
									<section aria-labelledby={`${conversationMessage.id}-context`}>
										<h4 id={`${conversationMessage.id}-context`}>Related context</h4>
										<ul>
											{#each relatedSources.slice(0, 3) as source (source.id)}
												<li>
													<a href={sourceHref(source)}>
														<span class="source-title">{source.title}</span>
														<small>{sourceTypeLabels[source.type]}</small>
													</a>
												</li>
											{/each}
										</ul>

										{#if relatedSources.length > 3}
											<details class="more-sources">
												<summary>Show {relatedSources.length - 3} more</summary>
												<ul>
													{#each relatedSources.slice(3) as source (source.id)}
														<li>
															<a href={sourceHref(source)}>
																<span class="source-title">{source.title}</span>
																<small>{sourceTypeLabels[source.type]}</small>
															</a>
														</li>
													{/each}
												</ul>
											</details>
										{/if}
									</section>
								{/if}
							</div>
						</details>
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

	.citation {
		display: inline-flex;
		margin-left: 0.15rem;
		padding: 0.05rem 0.25rem;
		border-radius: var(--border-radius-full);
		background: #efe2c6;
		color: #76551f;
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1.35;
		text-decoration: none;
		vertical-align: 0.12em;
	}

	.citation:hover {
		background: #e4cca0;
		color: #52380f;
	}

	.sources {
		margin-top: 0.75rem;
		padding-top: 0.65rem;
		border-top: 1px solid rgb(142 114 69 / 28%);
	}

	.sources > summary {
		display: flex;
		width: fit-content;
		align-items: center;
		gap: 0.35rem;
		color: #6d604d;
		cursor: pointer;
		list-style: none;
	}

	.sources > summary::-webkit-details-marker,
	.more-sources > summary::-webkit-details-marker {
		display: none;
	}

	.sources-label {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.source-count {
		display: grid;
		min-width: 1.35rem;
		height: 1.35rem;
		place-items: center;
		border-radius: var(--border-radius-full);
		background: #efe2c6;
		color: #5f503a;
		font-size: 0.68rem;
		font-weight: 700;
	}

	.citation-count {
		color: #81725d;
		font-size: 0.66rem;
	}

	.source-chevron {
		width: 0.9rem;
		height: 0.9rem;
		transition: transform 150ms ease;
	}

	.sources[open] > summary :global(.source-chevron) {
		transform: rotate(180deg);
	}

	.source-panel {
		display: grid;
		gap: 0.8rem;
		margin-top: 0.65rem;
		padding: 0.65rem;
		border: 1px solid rgb(164 132 79 / 28%);
		border-radius: var(--border-radius-sm);
		background: rgb(248 240 223 / 65%);
	}

	.source-panel h4 {
		margin: 0 0 0.35rem;
		color: #756650;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.source-panel ul {
		display: grid;
		gap: 0.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.source-panel a {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.25rem 0.3rem;
		border-radius: 0.25rem;
		color: #463a2a;
		font-size: 0.78rem;
		line-height: 1.3;
		text-decoration: none;
	}

	.source-panel a:hover {
		background: rgb(221 198 155 / 35%);
	}

	.source-title {
		min-width: 0;
		flex: 1;
	}

	.source-number {
		color: #8a672f;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.source-panel small {
		flex: none;
		color: #81725f;
		font-size: 0.65rem;
	}

	.more-sources {
		margin-top: 0.25rem;
	}

	.more-sources > summary {
		width: fit-content;
		padding: 0.2rem 0.3rem;
		color: #76551f;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}

	.more-sources[open] > summary {
		margin-bottom: 0.2rem;
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
