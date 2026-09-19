<script lang="ts">
	import { goto } from '$app/navigation'
	import type { PageProps } from './$types'
	import { startCampaignImport } from '../data.remote'

	type FileDraft = {
		id: string
		fileName: string
		size: number
		mediaType: 'text/markdown' | 'text/plain'
		content: string
	}

	type ImportAttempt = {
		ingestionId: string
		payloadKey: string
	}

	const maximumSources = 50
	const maximumSourceBytes = 2 * 1024 * 1024
	const maximumImportBytes = 10 * 1024 * 1024
	const encoder = new TextEncoder()
	let sourceSequence = 0

	let { params }: PageProps = $props()
	let pastedText = $state('')
	let files = $state<FileDraft[]>([])
	let isStarting = $state(false)
	let pickerError = $state('')
	let submitError = $state('')
	let retryAttempt: ImportAttempt | undefined

	const byteLength = (content: string) => encoder.encode(content).byteLength
	const formatFileSize = (size: number) =>
		size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`
	const hasPastedText = $derived(pastedText.trim().length > 0)
	const sourceCount = $derived(files.length + (hasPastedText ? 1 : 0))
	const pastedTextBytes = $derived(hasPastedText ? byteLength(pastedText) : 0)
	const totalBytes = $derived(
		pastedTextBytes + files.reduce((total, source) => total + byteLength(source.content), 0)
	)

	const validationErrors = $derived.by(() => {
		const errors: string[] = []
		if (sourceCount > maximumSources) {
			errors.push(`Use at most ${maximumSources} sources. Pasted notes count as one source.`)
		}
		if (totalBytes > maximumImportBytes) errors.push('The combined import must be at most 10 MB.')
		if (hasPastedText && pastedTextBytes > maximumSourceBytes) {
			errors.push('Pasted notes must be at most 2 MB.')
		}

		for (const source of files) {
			if (!source.content.length) errors.push(`${source.fileName} has no content.`)
			if (byteLength(source.content) > maximumSourceBytes) {
				errors.push(`${source.fileName} must be at most 2 MB.`)
			}
		}

		return errors
	})

	const removeSource = (id: string) => {
		files = files.filter((source) => source.id !== id)
		pickerError = ''
	}

	const addFiles = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement
		const selectedFiles = [...(input.files ?? [])]
		input.value = ''
		pickerError = ''
		if (!selectedFiles.length) return

		const errors: string[] = []
		const accepted: File[] = []
		for (const file of selectedFiles) {
			const lowerName = file.name.toLocaleLowerCase()
			if (!lowerName.endsWith('.md') && !lowerName.endsWith('.txt')) {
				errors.push(`${file.name} is not a Markdown or text file.`)
				continue
			}
			if (file.size > maximumSourceBytes) {
				errors.push(`${file.name} is larger than 2 MB.`)
				continue
			}
			if (file.name.length > 200 || /[\r\n]/u.test(file.name)) {
				errors.push(`${file.name} must have a one-line file name of at most 200 characters.`)
				continue
			}
			accepted.push(file)
		}

		if (sourceCount + accepted.length > maximumSources) {
			errors.push(`Choose fewer files. An import can contain at most ${maximumSources} sources.`)
			pickerError = errors.join(' ')
			return
		}

		const added: FileDraft[] = []
		for (const file of accepted) {
			sourceSequence += 1
			added.push({
				id: `file-${sourceSequence}`,
				fileName: file.name,
				size: file.size,
				mediaType: file.name.toLocaleLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain',
				content: await file.text()
			})
		}
		files.push(...added)
		pickerError = errors.join(' ')
	}

	const httpStatus = (error: unknown) => {
		if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
		return typeof error.status === 'number' ? error.status : undefined
	}

	const isUncertainTransportError = (error: unknown) => {
		const status = httpStatus(error)
		return status === undefined || status >= 500
	}

	const startImport = async (event: SubmitEvent) => {
		event.preventDefault()
		if (isStarting) return
		submitError = ''
		if (sourceCount === 0) return
		if (validationErrors.length) {
			submitError = 'Fix the notes and file errors listed below before starting the import.'
			return
		}

		const payloadSources = [
			...(hasPastedText
				? [
						{
							displayName: 'pasted-notes.txt',
							title: 'Pasted notes',
							mediaType: 'text/plain' as const,
							content: pastedText
						}
					]
				: []),
			...files.map((source) => ({
				displayName: source.fileName,
				title: source.fileName,
				mediaType: source.mediaType,
				content: source.content
			}))
		]
		const payloadKey = JSON.stringify({
			campaignId: params.campaignId,
			sources: payloadSources
		})
		const ingestionId =
			retryAttempt?.payloadKey === payloadKey ? retryAttempt.ingestionId : crypto.randomUUID()
		const request = {
			campaignId: params.campaignId,
			sources: payloadSources.map((source) => ({
				displayName: source.displayName,
				title: source.title,
				mediaType: source.mediaType,
				content: source.content
			}))
		}
		retryAttempt = undefined
		isStarting = true

		try {
			const reference = await startCampaignImport({ ...request, ingestionId })
			await goto(
				`/campaigns/${params.campaignId}/import/${encodeURIComponent(reference.ingestionId)}`
			)
		} catch (error) {
			if (isUncertainTransportError(error)) retryAttempt = { ingestionId, payloadKey }
			submitError = error instanceof Error ? error.message : 'Unable to start this campaign import.'
		} finally {
			isStarting = false
		}
	}
</script>

<svelte:head><title>Import campaign | Loremaster</title></svelte:head>

<section class="import-page" aria-labelledby="import-heading">
	<a class="back-link" href={`/campaigns/${params.campaignId}`}> ← Back to campaign workspace </a>
	<header class="page-heading">
		<p class="eyebrow">Campaign import</p>
		<h1 id="import-heading">Import campaign notes</h1>
		<p>
			Paste notes or add Markdown and text files. Loremaster infers whether they describe one
			document or several, identifies their types, and presents proposals for your review before
			making any changes.
		</p>
	</header>

	<form
		onsubmit={startImport}
		aria-busy={isStarting}
		aria-describedby={submitError ? 'import-submit-error' : undefined}
	>
		<section class="sources-section" aria-labelledby="sources-heading">
			<div>
				<p class="eyebrow">Notes</p>
				<h2 id="sources-heading">Add your campaign material</h2>
			</div>

			<label class="notes-field">
				<span>Paste notes</span>
				<textarea
					bind:value={pastedText}
					rows={14}
					aria-describedby="pasted-notes-help"
					placeholder="Paste campaign notes here…"></textarea>
			</label>
			<p id="pasted-notes-help" class="field-help">
				Pasted text is analyzed as one source. Whitespace-only text is ignored.
			</p>

			<div class="source-picker">
				<label for="source-files">Add Markdown or text files (optional)</label>
				<input
					id="source-files"
					type="file"
					accept=".md,.txt,text/markdown,text/plain"
					multiple
					onchange={addFiles}
				/>
				<p>Up to 50 sources, 2 MB each, and 10 MB total.</p>
			</div>

			<div class="source-summary" role="status" aria-live="polite">
				<span>{sourceCount} {sourceCount === 1 ? 'source' : 'sources'}</span>
				<span>{(totalBytes / 1024).toFixed(1)} KB of 10 MB</span>
			</div>
			{#if pickerError}<p class="error" role="alert">{pickerError}</p>{/if}

			{#if files.length}
				<div class="file-list" aria-label="Selected files">
					{#each files as file (file.id)}
						<div class="file-card">
							<div class="file-details">
								<strong>{file.fileName}</strong>
								<span>{formatFileSize(file.size)}</span>
							</div>
							<button
								type="button"
								class="remove-source"
								aria-label={`Remove ${file.fileName}`}
								onclick={() => removeSource(file.id)}
							>
								Remove
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if validationErrors.length}
			<div class="validation-summary" role="alert">
				<strong>Check your notes and files</strong>
				<ul>
					{#each validationErrors as error, index (`${index}:${error}`)}
						<li>{error}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="submit-panel">
			<div>
				<strong>Ready to analyze</strong>
				<p>You will review every proposed document and its type before anything changes.</p>
			</div>
			<button
				type="submit"
				disabled={isStarting || sourceCount === 0 || validationErrors.length > 0}
			>
				{isStarting ? 'Starting import…' : 'Analyze campaign notes'}
			</button>
		</div>
		<p class="submit-status" role="status" aria-live="polite" aria-atomic="true">
			{isStarting ? 'Starting campaign import analysis…' : ''}
		</p>
		{#if submitError}
			<p id="import-submit-error" class="error" role="alert">{submitError}</p>
		{/if}
	</form>
</section>

<style>
	.import-page {
		--ink: #282016;
		--ink-soft: #6f604e;
		box-sizing: border-box;
		width: min(76rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 5vw, 4rem);
		color: var(--ink);
	}

	.back-link,
	.eyebrow {
		color: #000;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.09em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.page-heading {
		max-width: 54rem;
		margin: 1.25rem 0 1.75rem;
		color: #000;
	}

	.page-heading h1 {
		margin: 0.2rem 0 0.55rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.4rem);
	}

	.page-heading p:last-child {
		margin: 0;
		color: #000;
		line-height: 1.55;
	}

	form {
		display: grid;
		gap: 1.25rem;
	}

	.sources-section,
	.validation-summary,
	.submit-panel {
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 94%);
		box-shadow: 0.25rem 0.25rem 0 #171d1a;
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-family: var(--font-display);
		font-size: clamp(1.4rem, 3vw, 2rem);
	}

	label {
		display: grid;
		gap: 0.4rem;
		font-weight: 700;
	}

	input[type='file'],
	textarea {
		box-sizing: border-box;
		width: 100%;
		padding: 0.65rem 0.75rem;
		border: 1px solid rgb(145 111 65 / 65%);
		border-radius: 3px;
		background: rgb(255 251 241 / 86%);
		color: #30291f;
		font: inherit;
	}

	textarea {
		resize: vertical;
		line-height: 1.45;
	}

	input:focus-visible,
	textarea:focus-visible,
	button:focus-visible,
	.back-link:focus-visible {
		outline: 2px solid #c8aa75;
		outline-offset: 2px;
	}

	.source-picker {
		display: grid;
		gap: 0.4rem;
	}

	.source-picker p,
	.field-help,
	.source-summary,
	.file-details span,
	.submit-panel p {
		color: var(--ink-soft);
		font-size: 0.82rem;
	}

	.source-summary {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.file-card,
	.submit-panel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.sources-section {
		display: grid;
		gap: 1rem;
	}

	.sources-section .eyebrow {
		color: #8a682f;
	}

	button {
		padding: 0.6rem 0.85rem;
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: #f1c278;
		box-shadow: 0.15rem 0.15rem 0 #3d382f;
		color: var(--ink);
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.file-list {
		display: grid;
		gap: 0.65rem;
	}

	.file-card {
		padding: 0.8rem 1rem;
		border: 1px solid rgb(119 91 52 / 55%);
		background: rgb(247 237 218 / 56%);
	}

	.file-details {
		display: grid;
		gap: 0.15rem;
	}

	.remove-source {
		border-color: #87423b;
		background: #fffaf0;
		box-shadow: none;
		color: #7c302a;
	}

	.notes-field textarea {
		min-height: 14rem;
	}

	.validation-summary {
		border-color: #9b4c40;
		color: #7b3029;
	}

	.validation-summary ul {
		margin: 0.55rem 0 0;
		padding-left: 1.2rem;
	}

	.submit-panel {
		background: #f4e8d0;
	}

	.submit-status {
		min-height: 1.2em;
		color: #000;
		font-size: 0.82rem;
	}

	.error {
		color: #a33e35;
	}

	@media (max-width: 760px) {
		.file-card,
		.submit-panel {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
