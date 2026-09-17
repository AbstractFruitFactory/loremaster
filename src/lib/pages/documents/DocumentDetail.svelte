<script lang="ts">
	import Button from '#lib/components/button/Button.svelte'
	import LoreContent from '#lib/components/lore-content/LoreContent.svelte'
	import Textarea from '#lib/components/textarea/Textarea.svelte'
	import TextInput from '#lib/components/text-input/TextInput.svelte'
	import { getDocumentBody, type DocumentType } from '#lib/document.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { VaultDocumentView } from '#lib/server/vault/types.js'

	export type DocumentSaveRequest = {
		title: string
		content: string
		currentRevisionId: string
	}

	type Props = {
		selectedType: DocumentType
		document: VaultDocumentView | undefined
		isLoading: boolean
		hasLoadError: boolean
		typeMismatch: boolean
		backHref: string
		historyHref: string
		onsave: (request: DocumentSaveRequest) => Promise<void>
	}

	type EditDraft = {
		title: string
		content: string
		initialTitle: string
		initialContent: string
		currentRevisionId: string
	}

	let {
		selectedType,
		document,
		isLoading,
		hasLoadError,
		typeMismatch,
		backHref,
		historyHref,
		onsave
	}: Props = $props()

	const category = $derived(documentTypeMetadata[selectedType])
	const componentId = $props.id()
	const titleInputId = `${componentId}-title`
	const titleRequirementsId = `${componentId}-title-requirements`
	const contentInputId = `${componentId}-content`
	const contentRequirementsId = `${componentId}-content-requirements`

	let draft = $state<EditDraft>()
	let isEditing = $state(false)
	let isSaving = $state(false)
	let saveError = $state<string>()
	let saveMessage = $state<string>()
	let hasStaleConflict = $state(false)

	const isDirty = $derived(
		Boolean(draft && (draft.title !== draft.initialTitle || draft.content !== draft.initialContent))
	)
	const isTitleValid = $derived(
		Boolean(
			draft &&
			draft.title.trim().length > 0 &&
			draft.title.length <= 200 &&
			!/[\r\n]/.test(draft.title)
		)
	)
	const isValid = $derived(Boolean(draft && isTitleValid && draft.content.length <= 1_000_000))
	const canSave = $derived(Boolean(isValid && isDirty && !isSaving && draft?.currentRevisionId))

	function startEditing() {
		if (!document?.currentRevisionId) return

		const content = getDocumentBody(document.content)
		draft = {
			title: document.title,
			content,
			initialTitle: document.title,
			initialContent: content,
			currentRevisionId: document.currentRevisionId
		}
		saveError = undefined
		saveMessage = undefined
		hasStaleConflict = false
		isEditing = true
	}

	function cancelEditing() {
		isEditing = false
		draft = undefined
		saveError = undefined
		hasStaleConflict = false
	}

	function errorStatus(value: unknown) {
		if (
			value &&
			typeof value === 'object' &&
			'status' in value &&
			typeof value.status === 'number'
		) {
			return value.status
		}
		return undefined
	}

	function reloadDocument() {
		window.location.reload()
	}

	async function saveDocument(event: SubmitEvent) {
		event.preventDefault()
		if (!draft?.currentRevisionId || !canSave) return

		isSaving = true
		saveError = undefined
		saveMessage = undefined
		hasStaleConflict = false

		try {
			await onsave({
				title: draft.title,
				content: draft.content,
				currentRevisionId: draft.currentRevisionId
			})
			isEditing = false
			draft = undefined
			saveMessage = 'Document changes saved.'
		} catch (error) {
			const status = errorStatus(error)
			hasStaleConflict = status === 409
			saveError =
				status === 409
					? 'This document changed after you opened it. Reload before saving again.'
					: 'The document could not be saved. Try again.'
		} finally {
			isSaving = false
		}
	}
</script>

<svelte:head>
	<title>{document?.title ?? category.label} | Loremaster</title>
</svelte:head>

<section class="document-detail" aria-label="Document detail">
	<nav class="document-navigation" aria-label="Document navigation">
		<a class="back-link" href={backHref}>← Back to {category.label}</a>
		{#if document && !hasLoadError && !typeMismatch}
			<a class="history-link" href={historyHref}>View history</a>
		{/if}
	</nav>

	{#if hasLoadError || typeMismatch}
		<div class="state-panel error" role="alert">
			<strong>Unable to load this entry.</strong>
			<span>It may have been removed or moved.</span>
		</div>
	{:else if isLoading}
		<div class="state-panel" role="status" aria-live="polite">Loading entry…</div>
	{:else if document}
		{#if saveMessage}
			<div class="edit-status success" role="status" aria-live="polite">{saveMessage}</div>
		{/if}

		<article class="document-window" aria-labelledby="document-heading" aria-busy={isSaving}>
			{#if isEditing && draft}
				<form class="edit-form" onsubmit={saveDocument} aria-busy={isSaving}>
					<header class="document-header edit-header">
						<h2 id="document-heading">Edit document</h2>
					</header>

					<div class="edit-fields">
						<label for={titleInputId}>Title</label>
						<TextInput
							id={titleInputId}
							bind:value={draft.title}
							required
							maxlength={200}
							autocomplete="off"
							disabled={isSaving}
							aria-invalid={!isTitleValid}
							aria-describedby={titleRequirementsId}
						/>
						<span class="field-hint" id={titleRequirementsId}>
							Required. Up to 200 characters on one line.
						</span>

						<label for={contentInputId}>Content</label>
						<Textarea
							id={contentInputId}
							bind:value={draft.content}
							maxlength={1_000_000}
							rows={18}
							disabled={isSaving}
							aria-describedby={contentRequirementsId}
							--textarea-min-height="20rem"
						/>
						<span class="field-hint" id={contentRequirementsId}>
							Markdown content, up to 1,000,000 characters.
						</span>
					</div>

					{#if saveError}
						<div
							class={['edit-status', 'error', hasStaleConflict && 'stale']}
							role="alert"
							aria-live="assertive"
						>
							<strong>{hasStaleConflict ? 'Reload required.' : 'Save failed.'}</strong>
							<span>{saveError}</span>
							{#if hasStaleConflict}
								<div class="status-action">
									<Button
										type="button"
										variant="secondary"
										onclick={reloadDocument}
										disabled={isSaving}>Reload document</Button
									>
								</div>
							{/if}
						</div>
					{/if}

					<div class="edit-actions">
						<Button type="submit" disabled={!canSave}>
							{isSaving ? 'Saving…' : 'Save changes'}
						</Button>
						<Button type="button" variant="secondary" onclick={cancelEditing} disabled={isSaving}
							>Cancel</Button
						>
					</div>
				</form>
			{:else}
				<header class="document-header">
					<div class="title-row">
						<h2 id="document-heading">{document.title}</h2>
						<Button
							type="button"
							variant="secondary"
							onclick={startEditing}
							disabled={!document.currentRevisionId}
							aria-label={`Edit ${document.title}`}>Edit</Button
						>
					</div>
				</header>

				<div class="document-body">
					<LoreContent content={getDocumentBody(document.content)} />
				</div>
			{/if}
		</article>
	{/if}
</section>

<style>
	.document-detail {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		box-sizing: border-box;
		width: min(64rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 6vw, 5rem);
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.document-navigation {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		margin-bottom: 1.25rem;
	}

	.back-link,
	.history-link {
		color: #d7b46e;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.back-link:hover,
	.history-link:hover {
		text-decoration: underline;
	}

	.back-link:focus-visible,
	.history-link:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 3px;
	}

	.document-header {
		position: relative;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgb(154 120 67 / 38%);
	}

	.document-window {
		padding: clamp(1.25rem, 3vw, 2rem);
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 90%);
		box-shadow: 0.3rem 0.3rem 0 #171d1a;
	}

	.document-header::after {
		position: absolute;
		bottom: -3px;
		left: 2.5rem;
		width: 5px;
		height: 5px;
		border: 1px solid var(--gold);
		background: #fffaf0;
		content: '';
		transform: rotate(45deg);
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1;
	}

	.edit-header h2 {
		font-size: clamp(1.8rem, 4vw, 2.4rem);
	}

	.edit-form,
	.edit-fields {
		display: grid;
	}

	.edit-form {
		gap: 1rem;
	}

	.edit-fields {
		gap: 0.4rem;
	}

	.edit-fields label {
		margin-top: 0.65rem;
		color: #4e422f;
		font-size: 0.84rem;
		font-weight: 700;
	}

	.edit-fields label:first-child {
		margin-top: 0;
	}

	.field-hint {
		color: var(--ink-soft);
		font-size: 0.76rem;
	}

	.edit-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.edit-status {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 1rem;
		padding: 0.85rem;
		border: 1px solid rgb(154 120 67 / 44%);
		background: rgb(244 230 199 / 68%);
		color: var(--ink-soft);
		font-size: 0.84rem;
	}

	.edit-form .edit-status {
		margin-bottom: 0;
	}

	.edit-status.error,
	.edit-status.error strong {
		color: #8b2f27;
	}

	.edit-status.stale {
		border-color: #9e6b28;
		background: #f5e5bd;
	}

	.edit-status.success {
		border-color: #6f956d;
		background: #dcebd5;
		color: #35563a;
	}

	.status-action {
		margin-top: 0.3rem;
	}

	.document-body {
		padding-top: 0.25rem;
	}

	.state-panel {
		display: grid;
		gap: 0.3rem;
		padding: 1.6rem;
		border: 1px dashed rgb(154 120 67 / 48%);
		background: rgb(250 240 219 / 42%);
		color: var(--ink-soft);
		text-align: center;
	}

	.state-panel strong {
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 600;
	}

	.state-panel.error,
	.state-panel.error strong {
		color: #8b2f27;
	}

	@media (max-width: 34rem) {
		.document-detail {
			padding-inline: 0.75rem;
		}

		.document-navigation {
			align-items: flex-start;
			flex-direction: column;
		}

		.title-row {
			align-items: stretch;
			flex-direction: column;
		}

		.edit-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.title-row :global(.button-shell),
		.edit-actions :global(.button-shell),
		.title-row :global(button.button),
		.edit-actions :global(button.button) {
			width: 100%;
		}
	}
</style>
