<script lang="ts">
	import Button from '#lib/components/button/Button.svelte'
	import type { PageProps } from './$types'
	import {
		createDocument,
		deleteDocument,
		getDocument,
		listDocuments,
		reindexCampaignVault,
		updateDocument
	} from './data.remote'

	let { params }: PageProps = $props()

	const campaignId = $derived(params.campaignId)
	const documents = $derived(listDocuments(campaignId))

	type VaultDocument = Awaited<ReturnType<typeof getDocument>>
	type Action = 'opening' | 'creating' | 'saving' | 'deleting' | 'reindexing'

	let selectedDocument = $state.raw<VaultDocument | null>(null)
	let draftType = $state('')
	let draftAliases = $state('')
	let draftContent = $state('')
	let newPath = $state('')
	let newType = $state('')
	let newAliases = $state('')
	let newContent = $state('')
	let pendingAction = $state<Action | null>(null)
	let statusMessage = $state('')
	let actionError = $state('')

	const parseAliases = (value: string) => {
		const aliases = value
			.split(',')
			.map((alias) => alias.trim())
			.filter(Boolean)

		return aliases.length ? aliases : undefined
	}

	const getErrorMessage = (error: unknown, fallback: string) =>
		error instanceof Error ? error.message : fallback

	const populateDraft = (document: VaultDocument) => {
		selectedDocument = document
		draftType = document.type ?? ''
		draftAliases = document.aliases?.join(', ') ?? ''
		draftContent = document.content
	}

	const openDocument = async (documentId: string) => {
		pendingAction = 'opening'
		actionError = ''
		statusMessage = ''

		try {
			const document = await getDocument({ campaignId, documentId })
			populateDraft(document)
			statusMessage = `Opened ${document.title}`
		} catch (error) {
			actionError = getErrorMessage(error, 'Unable to open the document')
		} finally {
			pendingAction = null
		}
	}

	const handleCreate = async (event: SubmitEvent) => {
		event.preventDefault()
		pendingAction = 'creating'
		actionError = ''
		statusMessage = ''

		try {
			const document = await createDocument({
				campaignId,
				path: newPath,
				type: newType.trim() || undefined,
				aliases: parseAliases(newAliases),
				content: newContent
			})
			populateDraft(document)
			newPath = ''
			newType = ''
			newAliases = ''
			newContent = ''
			statusMessage = `Created ${document.title}`
		} catch (error) {
			actionError = getErrorMessage(error, 'Unable to create the document')
		} finally {
			pendingAction = null
		}
	}

	const handleSave = async (event: SubmitEvent) => {
		event.preventDefault()
		if (!selectedDocument) return

		pendingAction = 'saving'
		actionError = ''
		statusMessage = ''

		try {
			const document = await updateDocument({
				campaignId,
				documentId: selectedDocument.id,
				type: draftType.trim() || undefined,
				aliases: parseAliases(draftAliases),
				content: draftContent
			})
			populateDraft(document)
			statusMessage = `Saved ${document.title}`
		} catch (error) {
			actionError = getErrorMessage(error, 'Unable to save the document')
		} finally {
			pendingAction = null
		}
	}

	const handleDelete = async () => {
		if (!selectedDocument || !confirm(`Delete "${selectedDocument.path}"?`)) return

		pendingAction = 'deleting'
		actionError = ''
		statusMessage = ''
		const deletedTitle = selectedDocument.title

		try {
			await deleteDocument({
				campaignId,
				documentId: selectedDocument.id
			})
			selectedDocument = null
			draftType = ''
			draftAliases = ''
			draftContent = ''
			statusMessage = `Deleted ${deletedTitle}`
		} catch (error) {
			actionError = getErrorMessage(error, 'Unable to delete the document')
		} finally {
			pendingAction = null
		}
	}

	const handleReindex = async () => {
		pendingAction = 'reindexing'
		actionError = ''
		statusMessage = ''

		try {
			const indexedDocuments = await reindexCampaignVault(campaignId)
			const updatedSelection = selectedDocument
				? indexedDocuments.find((document) => document.id === selectedDocument?.id)
				: undefined

			if (updatedSelection) populateDraft(updatedSelection)
			statusMessage = `Reindexed ${indexedDocuments.length} document${indexedDocuments.length === 1 ? '' : 's'}`
		} catch (error) {
			actionError = getErrorMessage(error, 'Unable to reindex the vault')
		} finally {
			pendingAction = null
		}
	}
</script>

<svelte:head>
	<title>Campaign vault | Loremaster</title>
	<meta name="description" content="Manage Markdown knowledge documents for this campaign." />
</svelte:head>

<main aria-busy={pendingAction !== null}>
	<header>
		<a href="/">← Campaigns</a>
		<div>
			<p class="eyebrow">Knowledge vault</p>
			<h1>Campaign documents</h1>
		</div>
		<Button variant="secondary" onclick={handleReindex} disabled={pendingAction !== null}>
			{pendingAction === 'reindexing' ? 'Reindexing…' : 'Reindex vault'}
		</Button>
	</header>

	<div class="status" aria-live="polite">
		{#if statusMessage}
			<p>{statusMessage}</p>
		{/if}
	</div>

	{#if actionError}
		<p class="error" role="alert">{actionError}</p>
	{/if}

	<div class="vault">
		<aside aria-labelledby="documents-heading">
			<div class="section-heading">
				<h2 id="documents-heading">Documents</h2>
				{#if documents.current}
					<span>{documents.current.length}</span>
				{/if}
			</div>

			{#if documents.error}
				<p class="error" role="alert">Unable to load documents.</p>
			{:else if documents.loading && !documents.current}
				<p role="status">Loading documents…</p>
			{:else if documents.current?.length}
				<ul class="document-list">
					{#each documents.current as document (document.id)}
						<li>
							<Button
								disabled={pendingAction !== null}
								aria-pressed={selectedDocument?.id === document.id}
								onclick={() => openDocument(document.id)}
							>
								<strong>{document.title}</strong>
								<span>{document.path}</span>
							</Button>
						</li>
					{/each}
				</ul>
			{:else}
				<p>No documents yet.</p>
			{/if}

			<hr />

			<h2 id="new-document-heading">New document</h2>
			<form class="create-form" onsubmit={handleCreate} aria-labelledby="new-document-heading">
				<label>
					Path
					<input
						bind:value={newPath}
						required
						minlength="4"
						maxlength="500"
						placeholder="Characters/Varek.md"
						autocomplete="off"
					/>
				</label>

				<label>
					Type <span class="optional">(optional)</span>
					<input bind:value={newType} maxlength="100" autocomplete="off" />
				</label>

				<label>
					Aliases <span class="optional">(comma-separated)</span>
					<input bind:value={newAliases} autocomplete="off" />
				</label>

				<label>
					Markdown body
					<textarea bind:value={newContent} rows="7"></textarea>
				</label>

				<Button type="submit" disabled={pendingAction !== null}>
					{pendingAction === 'creating' ? 'Creating…' : 'Create document'}
				</Button>
			</form>
		</aside>

		<section class="editor" aria-labelledby="editor-heading">
			{#if selectedDocument}
				<div class="editor-heading">
					<div>
						<p class="path">{selectedDocument.path}</p>
						<h2 id="editor-heading">{selectedDocument.title}</h2>
					</div>
					<Button variant="danger" onclick={handleDelete} disabled={pendingAction !== null}>
						{pendingAction === 'deleting' ? 'Deleting…' : 'Delete'}
					</Button>
				</div>

				<form class="edit-form" onsubmit={handleSave}>
					<div class="metadata">
						<label>
							Type <span class="optional">(optional)</span>
							<input bind:value={draftType} maxlength="100" autocomplete="off" />
						</label>

						<label>
							Aliases <span class="optional">(comma-separated)</span>
							<input bind:value={draftAliases} autocomplete="off" />
						</label>
					</div>

					<label>
						Markdown body
						<textarea class="markdown" bind:value={draftContent} rows="24"></textarea>
					</label>

					<Button type="submit" disabled={pendingAction !== null}>
						{pendingAction === 'saving' ? 'Saving…' : 'Save document'}
					</Button>
				</form>

				<div class="links">
					<h3>Extracted links</h3>
					{#if selectedDocument.links.length}
						<ul>
							{#each selectedDocument.links as link (link)}
								<li><code>{link}</code></li>
							{/each}
						</ul>
					{:else}
						<p>No links extracted.</p>
					{/if}
				</div>
			{:else}
				<div class="empty-editor">
					<h2 id="editor-heading">Select a document</h2>
					<p>Open a document from the list or create one to begin editing.</p>
				</div>
			{/if}
		</section>
	</div>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f5f3ef;
		color: #25231f;
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	main {
		width: min(90rem, calc(100% - 2rem));
		margin: 0 auto;
		padding: 1.5rem 0 3rem;
	}

	header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 1rem;
		align-items: center;
		margin-bottom: 1rem;
	}

	header a {
		color: #42513c;
		font-weight: 700;
		text-decoration: none;
	}

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: 0;
		font-size: clamp(1.6rem, 4vw, 2.4rem);
	}

	h2 {
		margin-bottom: 0.9rem;
		font-size: 1.1rem;
	}

	h3 {
		font-size: 1rem;
	}

	.eyebrow {
		margin-bottom: 0.25rem;
		color: #6b6255;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.status {
		min-height: 1.5rem;
		color: #3f6938;
	}

	.status p {
		margin-bottom: 0.5rem;
	}

	.error {
		color: #a12727;
	}

	.vault {
		display: grid;
		grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
		min-height: 42rem;
		overflow: hidden;
		border: 1px solid #d8d2c8;
		border-radius: 0.75rem;
		background: #fff;
	}

	aside,
	.editor {
		padding: 1.25rem;
	}

	aside {
		overflow-y: auto;
		border-right: 1px solid #d8d2c8;
		background: #fbfaf8;
	}

	.section-heading,
	.editor-heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}

	.section-heading span {
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: #e7e3dc;
		font-size: 0.8rem;
	}

	.document-list,
	.links ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.document-list {
		display: grid;
		gap: 0.4rem;
	}

	.document-list :global(button.button) {
		display: grid;
		width: 100%;
		justify-content: normal;
		justify-items: start;
		gap: 0.2rem;
		padding: 0.7rem;
		border: 1px solid transparent;
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		box-shadow: none;
		text-align: left;
		filter: none;
		transform: none;
	}

	.document-list :global(button.button strong),
	.document-list :global(button.button span) {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.document-list :global(button.button span) {
		color: #6b665e;
		font-size: 0.82rem;
		font-weight: 400;
	}

	.document-list :global(button.button:hover:not(:disabled)),
	.document-list :global(button.button[aria-pressed='true']) {
		border-color: #aeb7a9;
		background: #edf1eb;
		box-shadow: none;
		filter: none;
		transform: none;
	}

	.document-list :global(button.button:active:not(:disabled)) {
		box-shadow: none;
		filter: none;
		transform: none;
	}

	.path,
	.optional {
		color: #6b665e;
		font-size: 0.82rem;
		font-weight: 400;
	}

	hr {
		margin: 1.5rem 0;
		border: 0;
		border-top: 1px solid #d8d2c8;
	}

	form {
		display: grid;
		gap: 0.9rem;
	}

	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
		font-weight: 650;
	}

	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		padding: 0.65rem 0.7rem;
		border: 1px solid #aaa298;
		border-radius: 0.35rem;
		background: #fff;
		color: inherit;
		font: inherit;
	}

	textarea {
		resize: vertical;
	}

	.markdown {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		line-height: 1.55;
	}

	.metadata {
		display: grid;
		grid-template-columns: minmax(10rem, 0.5fr) minmax(14rem, 1fr);
		gap: 0.9rem;
	}

	.path {
		margin-bottom: 0.25rem;
	}

	.links {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #e0dcd5;
	}

	.links ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.links li {
		padding: 0.3rem 0.45rem;
		border-radius: 0.3rem;
		background: #eeeae3;
	}

	.empty-editor {
		display: grid;
		min-height: 30rem;
		place-content: center;
		color: #6b665e;
		text-align: center;
	}

	@media (max-width: 48rem) {
		header {
			grid-template-columns: 1fr;
		}

		.vault {
			grid-template-columns: 1fr;
		}

		aside {
			border-right: 0;
			border-bottom: 1px solid #d8d2c8;
		}

		.metadata {
			grid-template-columns: 1fr;
		}
	}
</style>
