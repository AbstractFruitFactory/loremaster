<script lang="ts">
	import DocumentDiff from './DocumentDiff.svelte'
	import type { RevisionDiff, VaultRevisionMetadata } from '#lib/server/vault/revisions/types.js'

	export type RestoreRevisionRequest = {
		revisionId: string
		expectedSourceHash: string | null
		currentRevisionId: string
	}

	type Props = {
		documentTitle?: string
		revisions: readonly VaultRevisionMetadata[] | undefined
		selectedRevisionId: string | undefined
		diff: RevisionDiff | undefined
		isLoading: boolean
		hasLoadError: boolean
		isDiffLoading: boolean
		hasDiffError: boolean
		backHref: string
		onselect: (revisionId: string) => void
		onrestore: (request: RestoreRevisionRequest) => Promise<void>
	}

	let {
		documentTitle,
		revisions,
		selectedRevisionId,
		diff,
		isLoading,
		hasLoadError,
		isDiffLoading,
		hasDiffError,
		backHref,
		onselect,
		onrestore
	}: Props = $props()

	let confirmingRevisionId = $state<string>()
	let isRestoring = $state(false)
	let restoreError = $state<string>()
	let restoreMessage = $state<string>()
	let hasStaleConflict = $state(false)

	const dateFormatter = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	})

	const sortedRevisions = $derived(
		revisions?.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)) ?? []
	)
	const currentRevision = $derived(sortedRevisions[0])
	const selectedRevision = $derived(
		sortedRevisions.find((revision) => revision.revisionId === selectedRevisionId) ??
			currentRevision
	)
	const resolvedTitle = $derived(documentTitle ?? titleFromPath(currentRevision?.path))

	function titleFromPath(path: string | undefined) {
		if (!path) return 'Document'
		const filename = path.split('/').at(-1) ?? path
		return filename.replace(/\.[^.]+$/, '').replaceAll('-', ' ')
	}

	function label(value: string) {
		return value.replaceAll(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' ')
	}

	function summary(revision: VaultRevisionMetadata) {
		return revision.changeSummary ?? `${label(revision.operation)} document`
	}

	function selectRevision(revisionId: string) {
		confirmingRevisionId = undefined
		restoreError = undefined
		restoreMessage = undefined
		hasStaleConflict = false
		onselect(revisionId)
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

	function reloadHistory() {
		window.location.reload()
	}

	async function restoreSelected() {
		if (!selectedRevision || !currentRevision) return

		isRestoring = true
		restoreError = undefined
		restoreMessage = undefined
		hasStaleConflict = false

		try {
			await onrestore({
				revisionId: selectedRevision.revisionId,
				expectedSourceHash: currentRevision.afterHash,
				currentRevisionId: currentRevision.revisionId
			})
			confirmingRevisionId = undefined
			restoreMessage = 'Revision restored. A new restore entry was added to history.'
		} catch (error) {
			const status = errorStatus(error)
			hasStaleConflict = status === 409
			restoreError =
				status === 409
					? 'The document changed while this history was open. Reload before restoring.'
					: status === 410
						? 'A deleted snapshot cannot be restored.'
						: 'The revision could not be restored. Try again.'
		} finally {
			isRestoring = false
		}
	}
</script>

<svelte:head>
	<title>{resolvedTitle} history | Loremaster</title>
</svelte:head>

<section class="document-history" aria-labelledby="history-heading" aria-busy={isRestoring}>
	<a class="back-link" href={backHref}>← Back to document</a>

	<header class="page-heading">
		<div>
			<p class="eyebrow">Document history</p>
			<h2 id="history-heading">{resolvedTitle}</h2>
		</div>
		{#if currentRevision}
			<dl class="current-base" aria-label="Current restore base">
				<div>
					<dt>Current revision</dt>
					<dd><code>{currentRevision.revisionId.slice(0, 8)}</code></dd>
				</div>
				<div>
					<dt>Source hash</dt>
					<dd>
						{#if currentRevision.afterHash}
							<code>{currentRevision.afterHash.slice(0, 10)}</code>
						{:else}
							<span>Deleted</span>
						{/if}
					</dd>
				</div>
			</dl>
		{/if}
	</header>

	{#if hasLoadError}
		<div class="state-panel error" role="alert">
			<strong>Unable to load document history.</strong>
			<span>Reload the page to try again.</span>
		</div>
	{:else if isLoading}
		<div class="state-panel" role="status" aria-live="polite">Opening the archive…</div>
	{:else if sortedRevisions.length === 0}
		<div class="state-panel">
			<strong>No revisions recorded.</strong>
			<span>Changes to this document will appear here.</span>
		</div>
	{:else}
		<div class="history-layout">
			<aside aria-labelledby="revision-list-heading">
				<h3 id="revision-list-heading">Revisions</h3>
				<ol class="revision-list">
					{#each sortedRevisions as revision, index (revision.revisionId)}
						<li>
							<button
								type="button"
								class:selected={revision.revisionId === selectedRevision?.revisionId}
								aria-pressed={revision.revisionId === selectedRevision?.revisionId}
								aria-controls="selected-revision-diff"
								onclick={() => selectRevision(revision.revisionId)}
							>
								<span class="revision-order"
									>{index === 0 ? 'Current' : `#${sortedRevisions.length - index}`}</span
								>
								<strong>{summary(revision)}</strong>
								<span class="revision-meta">
									<span>{label(revision.source)}</span>
									<span>{label(revision.operation)}</span>
								</span>
								<time datetime={revision.createdAt}>
									{dateFormatter.format(new Date(revision.createdAt))}
								</time>
							</button>
						</li>
					{/each}
				</ol>
			</aside>

			<article class="revision-detail" aria-labelledby="selected-revision-heading">
				{#if selectedRevision}
					<header class="revision-heading">
						<div>
							<p class="eyebrow">Selected revision</p>
							<h3 id="selected-revision-heading">{summary(selectedRevision)}</h3>
							<p class="revision-description">
								<span>{label(selectedRevision.source)} source</span>
								<span aria-hidden="true">·</span>
								<span>{label(selectedRevision.operation)} operation</span>
								<span aria-hidden="true">·</span>
								<time datetime={selectedRevision.createdAt}>
									{dateFormatter.format(new Date(selectedRevision.createdAt))}
								</time>
							</p>
						</div>
						<button
							type="button"
							class="restore-button"
							disabled={isRestoring ||
								!selectedRevision.hasSnapshot ||
								selectedRevision.revisionId === currentRevision?.revisionId}
							onclick={() => (confirmingRevisionId = selectedRevision.revisionId)}
						>
							{!selectedRevision.hasSnapshot
								? 'Deleted snapshot'
								: selectedRevision.revisionId === currentRevision?.revisionId
									? 'Current revision'
									: 'Restore revision'}
						</button>
					</header>

					{#if confirmingRevisionId === selectedRevision.revisionId}
						<div class="confirmation" role="alert">
							<strong>Restore this revision?</strong>
							<p>
								The current document will be replaced, and the restore will be recorded as a new
								revision.
							</p>
							<div class="confirmation-actions">
								<button
									type="button"
									class="confirm-button"
									disabled={isRestoring}
									onclick={restoreSelected}
								>
									{isRestoring ? 'Restoring…' : 'Confirm restore'}
								</button>
								<button
									type="button"
									class="cancel-button"
									disabled={isRestoring}
									onclick={() => (confirmingRevisionId = undefined)}
								>
									Cancel
								</button>
							</div>
						</div>
					{/if}

					{#if restoreError}
						<div class:stale={hasStaleConflict} class="restore-status error" role="alert">
							<strong>{hasStaleConflict ? 'History is out of date.' : 'Restore failed.'}</strong>
							<span>{restoreError}</span>
							{#if hasStaleConflict}
								<button type="button" class="reload-button" onclick={reloadHistory}>
									Reload history
								</button>
							{/if}
						</div>
					{:else if restoreMessage}
						<div class="restore-status success" role="status">{restoreMessage}</div>
					{/if}

					<div id="selected-revision-diff">
						<DocumentDiff {diff} isLoading={isDiffLoading} hasLoadError={hasDiffError} />
					</div>
				{/if}
			</article>
		</div>
	{/if}
</section>

<style>
	.document-history {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		box-sizing: border-box;
		width: min(76rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1rem, 4vw, 3rem);
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.back-link {
		display: inline-block;
		margin-bottom: 1.25rem;
		color: var(--gold);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	.page-heading {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 2rem;
		align-items: end;
		justify-content: space-between;
		margin-bottom: 1.25rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgb(154 120 67 / 38%);
	}

	h2,
	h3,
	p,
	dl,
	dd {
		margin: 0;
	}

	h2,
	h3 {
		font-family: var(--font-display);
	}

	h2 {
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1;
		text-transform: capitalize;
	}

	.eyebrow {
		margin-bottom: 0.2rem;
		color: var(--gold);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.current-base {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1.25rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid rgb(154 120 67 / 30%);
		background: rgb(250 241 222 / 55%);
	}

	.current-base div {
		display: grid;
		gap: 0.1rem;
	}

	.current-base dt {
		color: var(--ink-soft);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.current-base dd {
		font-size: 0.78rem;
	}

	.current-base code {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
	}

	.history-layout {
		display: grid;
		grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}

	aside,
	.revision-detail {
		min-width: 0;
	}

	aside > h3 {
		margin-bottom: 0.55rem;
		font-size: 1.25rem;
	}

	.revision-list {
		display: grid;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.revision-list button {
		display: grid;
		width: 100%;
		gap: 0.25rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid rgb(154 120 67 / 28%);
		background: rgb(250 241 222 / 44%);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.revision-list button:hover,
	.revision-list button.selected {
		border-color: rgb(154 120 67 / 68%);
		background: rgb(250 241 222 / 82%);
	}

	.revision-list button:focus-visible,
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid #9a7843;
		outline-offset: 2px;
	}

	.revision-list strong {
		overflow-wrap: anywhere;
		font-family: var(--font-display);
		font-size: 1rem;
		line-height: 1.1;
	}

	.revision-order {
		color: var(--gold);
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.revision-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.revision-meta span {
		padding: 0.1rem 0.38rem;
		border-radius: var(--border-radius-full);
		background: rgb(154 120 67 / 12%);
		color: var(--ink-soft);
		font-size: 0.65rem;
		text-transform: capitalize;
	}

	.revision-list time {
		color: var(--ink-soft);
		font-size: 0.68rem;
	}

	.revision-detail {
		padding: clamp(0.9rem, 2vw, 1.3rem);
		border: 1px solid rgb(154 120 67 / 32%);
		background: rgb(255 250 239 / 48%);
		box-shadow: inset 0 0 0 3px rgb(154 120 67 / 4%);
	}

	.revision-heading {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem 1.5rem;
		align-items: start;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.revision-heading h3 {
		font-size: 1.65rem;
	}

	.revision-description {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.3rem;
		color: var(--ink-soft);
		font-size: 0.78rem;
		text-transform: capitalize;
	}

	.restore-button,
	.confirm-button,
	.cancel-button {
		min-height: 2.35rem;
		padding: 0.55rem 0.85rem;
		border: 1px solid var(--gold);
		background: #6f522d;
		color: #fffaf0;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		cursor: pointer;
	}

	.cancel-button {
		background: transparent;
		color: var(--ink);
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.confirmation,
	.restore-status {
		display: grid;
		gap: 0.4rem;
		margin-bottom: 1rem;
		padding: 0.85rem;
		border: 1px solid rgb(154 120 67 / 44%);
		background: rgb(244 230 199 / 68%);
	}

	.confirmation p,
	.restore-status {
		color: var(--ink-soft);
		font-size: 0.82rem;
	}

	.confirmation-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.restore-status.error,
	.restore-status.error strong {
		color: #8b2f27;
	}

	.restore-status.stale {
		border-color: #9e6b28;
		background: #f5e5bd;
	}

	.reload-button {
		width: fit-content;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		text-decoration: underline;
		cursor: pointer;
	}

	.restore-status.success {
		border-color: #6f956d;
		background: #dcebd5;
		color: #35563a;
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
	}

	.state-panel.error,
	.state-panel.error strong {
		color: #8b2f27;
	}

	@media (max-width: 52rem) {
		.history-layout {
			grid-template-columns: 1fr;
		}

		.revision-list {
			grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		}
	}

	@media (max-width: 34rem) {
		.document-history {
			padding-inline: 0.75rem;
		}

		.revision-detail {
			padding-inline: 0.65rem;
		}

		.restore-button {
			width: 100%;
		}
	}
</style>
