<script module lang="ts">
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
</script>

<script lang="ts">
	const sourceTypeLabels: Record<DocumentType, string> = {
		player: 'Player',
		npc: 'NPC',
		location: 'Location',
		session: 'Session',
		item: 'Item',
		lore: 'Lore',
		event: 'Event'
	}

	let {
		messages,
		isResponding = false
	}: {
		messages: readonly ConversationMessage[]
		isResponding?: boolean
	} = $props()
</script>

<div class="message-feed" aria-live="polite">
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
			{#each messages as conversationMessage (conversationMessage.id)}
				<li class={conversationMessage.role}>
					<p class="speaker">
						{conversationMessage.role === 'user' ? 'You' : 'Loremaster'}
					</p>
					<div class="message-content">{conversationMessage.content}</div>
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
		min-height: 13rem;
		max-height: clamp(19rem, 48vh, 34rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}

	.welcome {
		display: flex;
		gap: var(--spacing-md);
		align-items: center;
		max-width: 38rem;
		min-height: 13rem;
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
