<script module lang="ts">
	import type { LoreProposalDraft } from '#lib/components/lore-proposal/LoreProposal.svelte'

	export type AskLoremasterInput = {
		message: string
		history: Array<{ role: 'user' | 'assistant'; content: string }>
	}

	export type AddLoreInput = LoreProposalDraft
</script>

<script lang="ts">
	import ChatInput from '#lib/components/chat-input/ChatInput.svelte'
	import ConversationFeed from '#lib/components/conversation-feed/ConversationFeed.svelte'
	import type { ConversationMessage } from '#lib/components/conversation-feed/ConversationFeed.svelte'
	import type { DocumentType } from '#lib/document.js'
	import type { AssistantResponse } from '#lib/server/assistant/types.js'

	type Props = {
		onask: (input: AskLoremasterInput) => Promise<AssistantResponse>
		onaddlore: (draft: AddLoreInput) => Promise<{ title: string }>
	}

	type ActiveProposal = {
		messageId: string
		draft: AddLoreInput
	}

	const proposalCategories: Array<{ value: DocumentType; label: string }> = [
		{ value: 'player', label: 'Players' },
		{ value: 'npc', label: 'NPCs' },
		{ value: 'location', label: 'Locations' },
		{ value: 'session', label: 'Sessions' },
		{ value: 'item', label: 'Items' },
		{ value: 'lore', label: 'Lore' },
		{ value: 'event', label: 'Events' }
	]

	let { onask, onaddlore }: Props = $props()

	let messages = $state.raw<ConversationMessage[]>([])
	let proposal = $state<ActiveProposal | null>(null)
	let message = $state('')
	let isResponding = $state(false)
	let isAddingLore = $state(false)
	let statusMessage = $state('')
	let actionError = $state('')
	let proposalError = $state('')

	const getErrorMessage = (error: unknown, fallback: string) =>
		error instanceof Error ? error.message : fallback

	const createMessageId = () => crypto.randomUUID()

	const handleAsk = async () => {
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
			const response = await onask({
				message: submittedMessage,
				history
			})
			const assistantMessageId = createMessageId()
			messages = [
				...messages,
				{
					id: assistantMessageId,
					role: 'assistant',
					content: response.message,
					sources: response.sources
				}
			]

			if (response.proposal) {
				proposal = {
					messageId: assistantMessageId,
					draft: {
						title: response.proposal.title,
						category: response.proposal.category,
						content: response.proposal.content
					}
				}
			}
		} catch (error) {
			actionError = getErrorMessage(error, 'Loremaster could not respond')
		} finally {
			isResponding = false
		}
	}

	const handleAddLore = async (draft: AddLoreInput) => {
		if (!proposal || isAddingLore) return

		const title = draft.title.trim()
		const content = draft.content.trim()
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
			const createdLore = await onaddlore({
				title,
				category: draft.category,
				content
			})
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

<main class="assistant-page">
	<div class="announcements" aria-live="polite" aria-atomic="true">
		{#if statusMessage}
			<p class="success" role="status">{statusMessage}</p>
		{/if}
		{#if actionError}
			<p class="error" role="alert">{actionError}</p>
		{/if}
	</div>

	<section class="conversation" aria-labelledby="conversation-heading">
		<div class="conversation-heading">
			<div>
				<p class="eyebrow">Creative companion</p>
				<h2 id="conversation-heading">Ask Loremaster</h2>
			</div>
		</div>

		<ConversationFeed
			{messages}
			{isResponding}
			{proposal}
			proposalCategoryOptions={proposalCategories}
			isProposalSubmitting={isAddingLore}
			{proposalError}
			onproposalsave={handleAddLore}
			onproposalcancel={cancelProposal}
		/>

		<div class="composer">
			<ChatInput
				id="loremaster-message"
				bind:value={message}
				isSubmitting={isResponding}
				onsubmit={handleAsk}
			/>
		</div>
	</section>
</main>

<style>
	.assistant-page {
		box-sizing: border-box;
		display: flex;
		width: min(64rem, calc(100% - 2rem));
		height: 100%;
		min-height: 0;
		margin: 0 auto;
		padding: clamp(1rem, 3vw, 2rem) 0 clamp(0.75rem, 2vw, 1.25rem);
		flex-direction: column;
		overflow: hidden;
		color: #30291f;
		font-family: var(--font-sans);
	}

	h2,
	p {
		margin-top: 0;
	}

	h2 {
		margin-bottom: 0;
		font-family: var(--font-display);
		font-weight: 600;
	}

	h2 {
		color: #40311f;
		font-size: clamp(1.55rem, 3vw, 2rem);
		line-height: 1;
	}

	.announcements {
		display: grid;
		flex: none;
		gap: var(--spacing-sm);
	}

	.announcements p {
		margin-bottom: var(--spacing-sm);
		padding: 0.65rem 0.85rem;
		border: 1px solid;
		border-radius: var(--border-radius-md);
		font-weight: 600;
	}

	.success {
		border-color: #92a584;
		background: #edf3e7;
		color: #35522e;
	}

	.error {
		color: #842f25;
	}

	.announcements .error {
		border-color: #c58e7e;
		background: #f8e7df;
	}

	.conversation {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.conversation-heading {
		display: flex;
		flex: none;
		justify-content: space-between;
		gap: var(--spacing-md);
		align-items: flex-start;
	}

	.conversation-heading {
		padding: 0 1.5rem 0.75rem;
	}

	.eyebrow {
		margin-bottom: 0.2rem;
		color: #786342;
		font-size: 0.67rem;
		font-weight: 600;
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}

	.presence {
		flex: none;
		border-radius: var(--border-radius-full);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.presence {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.2rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid #9cad8d;
		background: rgb(237 245 229 / 80%);
		color: #3f5b36;
	}

	.presence > span {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: #52744a;
		box-shadow: 0 0 0 0.17rem rgb(82 116 74 / 13%);
	}

	.presence.working {
		border-color: #c4a96f;
		background: rgb(250 239 211 / 80%);
		color: #75591f;
	}

	.presence.working > span {
		background: #a47a27;
	}

	.composer {
		flex: none;
		padding: 0.75rem 1.5rem 0;
	}

	@media (max-width: 44rem) {
		.assistant-page {
			width: min(100% - 1rem, 64rem);
			padding-top: var(--spacing-md);
		}

		.conversation-heading,
		.composer {
			padding-right: var(--spacing-md);
			padding-left: var(--spacing-md);
		}
	}
</style>
