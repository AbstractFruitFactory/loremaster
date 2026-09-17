<script module lang="ts">
	import type { LoreProposalDraft } from '#lib/components/lore-proposal/LoreProposal.svelte'

	export type ChatDockMode = 'sidebar' | 'expanded' | 'hidden'

	export type AskLoremasterInput = {
		message: string
	}

	export type AddLoreInput = LoreProposalDraft
</script>

<script lang="ts">
	import Icon from '@iconify/svelte'
	import { onDestroy, tick, untrack } from 'svelte'
	import logo from '#lib/assets/logo-eye.png'
	import ChatInput from '#lib/components/chat-input/ChatInput.svelte'
	import ConversationFeed from '#lib/components/conversation-feed/ConversationFeed.svelte'
	import type { ConversationMessage } from '#lib/components/conversation-feed/ConversationFeed.svelte'
	import Window from '#lib/components/window/Window.svelte'
	import type { ProposalDocumentType } from '#lib/document.js'
	import type { AssistantStreamEvent } from '#lib/server/assistant/types.js'

	type Props = {
		campaignId: string
		mode?: ChatDockMode
		id?: string
		toggleId?: string
		conversationHistory: ConversationMessage[]
		onask: (input: AskLoremasterInput, signal: AbortSignal) => AsyncIterable<AssistantStreamEvent>
		onaddlore: (draft: AddLoreInput) => Promise<{ title: string }>
	}

	type ActiveProposal = {
		messageId: string
		draft: AddLoreInput
	}

	const proposalCategories: Array<{ value: ProposalDocumentType; label: string }> = [
		{ value: 'player', label: 'Players' },
		{ value: 'npc', label: 'NPCs' },
		{ value: 'location', label: 'Locations' },
		{ value: 'item', label: 'Items' },
		{ value: 'worldbuilding', label: 'Worldbuilding' },
		{ value: 'event', label: 'Events' }
	]

	let {
		campaignId,
		mode = $bindable<ChatDockMode>('sidebar'),
		id = 'campaign-chat-panel',
		toggleId = 'campaign-chat-toggle',
		conversationHistory,
		onask,
		onaddlore
	}: Props = $props()

	let messages = $state.raw<ConversationMessage[]>(untrack(() => conversationHistory))
	let proposal = $state<ActiveProposal | null>(null)
	let message = $state('')
	let isResponding = $state(false)
	let isAddingLore = $state(false)
	let statusMessage = $state('')
	let actionError = $state('')
	let proposalError = $state('')
	let activeRequest: AbortController | null = null

	const isExpanded = $derived(mode === 'expanded')
	const modeActionLabel = $derived(
		isExpanded ? 'Restore Ask Loremaster sidebar' : 'Expand Ask Loremaster'
	)
	const modeActionIcon = $derived(isExpanded ? 'lucide:minimize-2' : 'lucide:maximize-2')

	onDestroy(() => activeRequest?.abort())

	const getErrorMessage = (error: unknown, fallback: string) =>
		error instanceof Error ? error.message : fallback

	const createMessageId = () => crypto.randomUUID()

	const updateAssistantMessage = (
		messageId: string,
		update: (message: ConversationMessage) => ConversationMessage
	) => {
		messages = messages.map((conversationMessage) =>
			conversationMessage.id === messageId ? update(conversationMessage) : conversationMessage
		)
	}

	const handleAsk = async () => {
		const submittedMessage = message.trim()
		if (!submittedMessage || isResponding) return

		const assistantMessageId = createMessageId()
		const requestController = new AbortController()
		activeRequest = requestController
		messages = [
			...messages,
			{ id: createMessageId(), role: 'user', content: submittedMessage, sources: [] },
			{ id: assistantMessageId, role: 'assistant', content: '', sources: [] }
		]
		message = ''
		isResponding = true
		statusMessage = ''
		actionError = ''
		proposalError = ''

		try {
			for await (const event of onask({ message: submittedMessage }, requestController.signal)) {
				if (event.type === 'text-delta') {
					updateAssistantMessage(assistantMessageId, (assistantMessage) => ({
						...assistantMessage,
						content: assistantMessage.content + event.delta
					}))
				}

				if (event.type === 'sources') {
					updateAssistantMessage(assistantMessageId, (assistantMessage) => ({
						...assistantMessage,
						sources: event.sources
					}))
				}

				if (event.type === 'proposal') {
					proposal = {
						messageId: assistantMessageId,
						draft: {
							title: event.proposal.title,
							category: event.proposal.category,
							content: event.proposal.content
						}
					}
				}

				if (event.type === 'error') {
					throw new Error(event.message)
				}
			}
		} catch (error) {
			const assistantMessage = messages.find(
				(conversationMessage) => conversationMessage.id === assistantMessageId
			)
			if (!assistantMessage?.content) {
				messages = messages.filter(
					(conversationMessage) => conversationMessage.id !== assistantMessageId
				)
				if (proposal?.messageId === assistantMessageId) proposal = null
			}
			actionError = getErrorMessage(error, 'Loremaster could not respond')
		} finally {
			if (activeRequest === requestController) activeRequest = null
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
			const createdLore = await onaddlore({ title, category: draft.category, content })
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

	const toggleMode = () => {
		mode = isExpanded ? 'sidebar' : 'expanded'
	}

	const hideChat = async () => {
		mode = 'hidden'
		await tick()
		document.getElementById(toggleId)?.focus()
	}

	const handleWindowKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || mode !== 'expanded') return
		mode = 'sidebar'
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if mode !== 'hidden'}
	<aside {id} class={['chat-panel', isExpanded && 'expanded']} aria-label="Ask Loremaster">
		<Window title="Ask Loremaster" eyebrow="Creative companion" size="fill">
			{#snippet icon()}
				<img src={logo} alt="" />
			{/snippet}

			{#snippet actions()}
				<button
					class="window-action"
					type="button"
					aria-label={modeActionLabel}
					title={modeActionLabel}
					onclick={toggleMode}
				>
					<Icon icon={modeActionIcon} aria-hidden="true" />
				</button>
				<button
					class="window-action"
					type="button"
					aria-label="Hide Ask Loremaster"
					title="Hide Ask Loremaster"
					onclick={hideChat}
				>
					<Icon icon="lucide:x" aria-hidden="true" />
				</button>
			{/snippet}

			{#snippet footer()}
				<ChatInput
					id="loremaster-panel-message"
					bind:value={message}
					isSubmitting={isResponding}
					onsubmit={handleAsk}
				/>
			{/snippet}

			<div class="conversation">
				<div class="announcements" aria-live="polite" aria-atomic="true">
					{#if statusMessage}<p class="success" role="status">{statusMessage}</p>{/if}
					{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
				</div>

				<ConversationFeed
					{campaignId}
					{messages}
					{isResponding}
					{proposal}
					proposalCategoryOptions={proposalCategories}
					isProposalSubmitting={isAddingLore}
					{proposalError}
					onproposalsave={handleAddLore}
					onproposalcancel={cancelProposal}
				/>
			</div>
		</Window>
	</aside>
{/if}

<style>
	.chat-panel {
		position: absolute;
		z-index: 10;
		top: var(--workspace-gap, 1rem);
		right: var(--workspace-gap, 1rem);
		bottom: var(--workspace-gap, 1rem);
		width: var(--chat-panel-width, 29rem);
		transition: width var(--chat-resize-duration, 180ms) var(--chat-resize-easing, ease);
	}

	.chat-panel.expanded {
		width: calc(100% - (2 * var(--workspace-gap, 1rem)));
	}

	.window-action :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.window-action {
		display: grid;
		width: 2rem;
		height: 2rem;
		padding: 0;
		place-items: center;
		border: 1.5px solid #25231f;
		border-radius: 1px;
		background: #fffaf0;
		color: #25231f;
		cursor: pointer;
	}

	.window-action:hover {
		background: #f2c07b;
	}

	.conversation {
		display: flex;
		flex: 1;
		min-height: 0;
		flex-direction: column;
	}

	.announcements {
		display: grid;
		flex: none;
		gap: 0.4rem;
	}

	.announcements p {
		margin: 0 0 0.5rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.success {
		border-color: #92a584;
		background: #edf3e7;
		color: #35522e;
	}

	.error {
		border-color: #c58e7e;
		background: #f8e7df;
		color: #842f25;
	}

	@media (max-width: 72rem) {
		.chat-panel {
			width: min(31rem, calc(100% - (2 * var(--workspace-gap, 1rem))));
		}
	}

	@media (max-width: 38rem) {
		.chat-panel {
			width: calc(100% - (2 * var(--workspace-gap, 0.65rem)));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.chat-panel {
			transition: none;
		}
	}
</style>
