<script lang="ts">
	import Icon from '@iconify/svelte'
	import { tick } from 'svelte'
	import type { Attachment } from 'svelte/attachments'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { SessionIngestionSummary } from '#lib/server/ingestion/types.js'
	import type { VaultDocumentSummary } from '#lib/server/vault/types.js'

	type Props = {
		campaignId: string
		documents: readonly VaultDocumentSummary[] | undefined
		isLoading: boolean
		hasLoadError: boolean
		uncommittedSessions?: readonly SessionIngestionSummary[]
		areUncommittedSessionsLoading?: boolean
		haveUncommittedSessionsLoadError?: boolean
		ondiscardUncommittedSession?: (ingestionId: string) => Promise<void>
		onreloadUncommittedSessions?: () => Promise<void>
	}

	let {
		campaignId,
		documents,
		isLoading,
		hasLoadError,
		uncommittedSessions,
		areUncommittedSessionsLoading = false,
		haveUncommittedSessionsLoadError = false,
		ondiscardUncommittedSession,
		onreloadUncommittedSessions
	}: Props = $props()

	const heading = documentTypeMetadata.session.label
	const phaseLabels = {
		analyzing: 'Analysis in progress',
		review: 'Ready for review',
		committing: 'Saving changes'
	} satisfies Record<SessionIngestionSummary['phase'], string>

	let confirmingIngestionId = $state<string>()
	let discardingIngestionId = $state<string>()
	let discardError = $state<{ ingestionId: string; message: string }>()
	let discardedIngestionIds = $state<string[]>([])
	let discardAnnouncement = $state('')
	let reloadingUncommittedSessions = $state(false)
	let discardTrigger: HTMLButtonElement | undefined
	const focusTargets: {
		ingestLink?: HTMLAnchorElement
	} = {}
	const captureIngestLink: Attachment<HTMLAnchorElement> = (element) => {
		focusTargets.ingestLink = element
		return () => {
			if (focusTargets.ingestLink === element) focusTargets.ingestLink = undefined
		}
	}

	const visibleUncommittedSessions = $derived(
		uncommittedSessions?.filter(({ ingestionId }) => !discardedIngestionIds.includes(ingestionId))
	)

	const formatIngestionDate = (createdAt: string) =>
		new Intl.DateTimeFormat('en', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'UTC'
		}).format(new Date(createdAt))

	const requestDiscard = (ingestionId: string, trigger: HTMLButtonElement) => {
		discardTrigger = trigger
		confirmingIngestionId = ingestionId
		discardError = undefined
		discardAnnouncement = ''
	}

	const focusAfterDiscardChange = async () => {
		await tick()
		focusTargets.ingestLink?.focus()
	}

	const cancelDiscard = async () => {
		const trigger = discardTrigger
		confirmingIngestionId = undefined
		discardError = undefined
		await tick()
		trigger?.focus()
	}

	const confirmDiscard = async (session: SessionIngestionSummary) => {
		if (!ondiscardUncommittedSession || discardingIngestionId) return
		discardingIngestionId = session.ingestionId
		discardError = undefined
		discardAnnouncement = ''
		try {
			await ondiscardUncommittedSession(session.ingestionId)
			discardedIngestionIds = [...discardedIngestionIds, session.ingestionId]
			confirmingIngestionId = undefined
			discardAnnouncement = `${session.title} was discarded.`
			await focusAfterDiscardChange()
		} catch {
			discardError = {
				ingestionId: session.ingestionId,
				message: 'This session could not be discarded. Try again.'
			}
		} finally {
			discardingIngestionId = undefined
		}
	}

	const reloadUncommittedSessions = async () => {
		if (!onreloadUncommittedSessions || reloadingUncommittedSessions) return
		reloadingUncommittedSessions = true
		try {
			await onreloadUncommittedSessions()
		} catch {
		} finally {
			reloadingUncommittedSessions = false
		}
	}
</script>

<svelte:head>
	<title>{heading} | Loremaster</title>
</svelte:head>

<section class="documents-page" aria-label={heading}>
	<div class="page-actions">
		<a
			{@attach captureIngestLink}
			class="ingest-link"
			href={`/campaigns/${campaignId}/session/ingest`}>Ingest session</a
		>
	</div>

	<p class="discard-announcement" role="status" aria-live="polite">{discardAnnouncement}</p>

	{#if areUncommittedSessionsLoading || haveUncommittedSessionsLoadError || visibleUncommittedSessions?.length}
		<section class="uncommitted-sessions" aria-label="Uncommitted sessions">
			{#if haveUncommittedSessionsLoadError}
				<div class="pending-state error" role="alert">
					<strong>Unable to load uncommitted sessions.</strong>
					<span>Saved sessions are still available below.</span>
					{#if onreloadUncommittedSessions}
						<button
							type="button"
							disabled={reloadingUncommittedSessions}
							onclick={reloadUncommittedSessions}
						>
							{reloadingUncommittedSessions ? 'Retrying…' : 'Try again'}
						</button>
					{/if}
				</div>
			{/if}
			{#if areUncommittedSessionsLoading && !visibleUncommittedSessions?.length}
				<div class="pending-state" role="status">Loading uncommitted sessions…</div>
			{:else if visibleUncommittedSessions?.length}
				<ul class="uncommitted-list">
					{#each visibleUncommittedSessions as session (session.ingestionId)}
						<li>
							<article class="uncommitted-card">
								<div class="uncommitted-card-heading">
									<div>
										<span class={`phase-badge ${session.phase}`}>
											{phaseLabels[session.phase]}
										</span>
										<h3>
											<a href={`/campaigns/${campaignId}/session/ingest/${session.ingestionId}`}>
												{session.title}
											</a>
										</h3>
									</div>
									<Icon icon="lucide:file-clock" aria-hidden="true" />
								</div>

								<div class="uncommitted-card-footer">
									<time datetime={session.createdAt}>
										{formatIngestionDate(session.createdAt)} UTC
									</time>
									<div class="uncommitted-actions">
										<a
											class="continue-link"
											href={`/campaigns/${campaignId}/session/ingest/${session.ingestionId}`}
										>
											{session.phase === 'review' ? 'Review' : 'View status'}
										</a>
										{#if session.canDiscard && ondiscardUncommittedSession}
											<button
												type="button"
												class="discard-button"
												aria-expanded={confirmingIngestionId === session.ingestionId}
												aria-controls={`discard-${session.ingestionId}`}
												disabled={Boolean(discardingIngestionId)}
												onclick={(event) =>
													requestDiscard(session.ingestionId, event.currentTarget)}
											>
												Discard
											</button>
										{/if}
									</div>
								</div>

								{#if confirmingIngestionId === session.ingestionId}
									<div
										id={`discard-${session.ingestionId}`}
										class="discard-confirmation"
										role="group"
										aria-label={`Discard ${session.title}`}
									>
										<p>This permanently deletes the uploaded transcript and its analysis.</p>
										<div>
											<button
												type="button"
												class="confirm-discard"
												disabled={discardingIngestionId === session.ingestionId}
												onclick={() => confirmDiscard(session)}
											>
												{discardingIngestionId === session.ingestionId
													? 'Discarding…'
													: 'Discard session'}
											</button>
											<button
												type="button"
												disabled={discardingIngestionId === session.ingestionId}
												onclick={cancelDiscard}
											>
												Cancel
											</button>
										</div>
										{#if discardError?.ingestionId === session.ingestionId}
											<p class="discard-error" role="alert">{discardError.message}</p>
										{/if}
									</div>
								{/if}
							</article>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if hasLoadError}
		<div class="state-panel error" role="alert">
			<strong>Unable to load {heading.toLowerCase()}.</strong>
			<span>Try again in a moment.</span>
		</div>
	{:else if isLoading}
		<div class="state-panel" role="status" aria-live="polite">Loading {heading.toLowerCase()}…</div>
	{:else if documents?.length}
		<ul class="document-list">
			{#each documents as document (document.id)}
				<li>
					<a
						class="document-card"
						href={`/campaigns/${campaignId}/${document.type}/${document.id}`}
					>
						<div class="card-heading">
							<span class="card-icon" aria-hidden="true">
								<span class="card-icon-corner top-left"></span>
								<span class="card-icon-corner top-right"></span>
								<span class="card-icon-corner bottom-left"></span>
								<span class="card-icon-corner bottom-right"></span>
								<img src={documentTypeMetadata.session.iconSrc} alt="" />
							</span>
							<span class="card-arrow" aria-hidden="true">
								<Icon icon="lucide:arrow-up-right" />
							</span>
						</div>
						<h3>{document.title}</h3>
						{#if document.summary}
							<p>{document.summary}</p>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="state-panel">
			<strong>No saved sessions yet.</strong>
			<span>Documents in this category will appear here.</span>
		</div>
	{/if}
</section>

<style>
	.documents-page {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		--gold-light: #c8aa75;
		box-sizing: border-box;
		width: 100%;
		padding: clamp(1.5rem, 3vw, 2.75rem)
			var(--campaign-inline-padding, clamp(1.25rem, 3vw, 2.75rem)) 2rem;
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.ingest-link {
		padding: 0.55rem 0.75rem;
		border: 1.5px solid #353129;
		border-radius: 2px;
		background: #f1c278;
		box-shadow: 0.16rem 0.16rem 0 #353129;
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.ingest-link:hover {
		background: rgb(250 241 222 / 95%);
	}

	.ingest-link:focus-visible {
		outline: 2px solid var(--gold-light);
		outline-offset: 3px;
	}

	h3,
	p {
		margin: 0;
	}

	h3 {
		font-family: var(--font-display);
	}

	.page-actions {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 1.5rem;
	}

	.discard-announcement {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		border: 0;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	.uncommitted-sessions {
		margin-bottom: 2rem;
	}

	.uncommitted-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr));
		gap: 0.85rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.uncommitted-list li {
		padding: 0;
		border: 0;
		background: none;
		box-shadow: none;
	}

	.uncommitted-card {
		display: grid;
		gap: 1rem;
		min-height: 9rem;
		padding: 1rem;
		border: 1.5px solid rgb(154 120 67 / 58%);
		border-radius: 2px;
		background: rgb(255 248 232 / 82%);
		box-shadow: 0.16rem 0.16rem 0 rgb(154 120 67 / 52%);
	}

	.uncommitted-card-heading,
	.uncommitted-card-footer,
	.uncommitted-actions,
	.discard-confirmation > div {
		display: flex;
	}

	.uncommitted-card-heading {
		gap: 1rem;
		align-items: start;
		justify-content: space-between;
	}

	.uncommitted-card-heading :global(svg) {
		flex: 0 0 auto;
		width: 1.25rem;
		height: 1.25rem;
		color: var(--gold);
	}

	.uncommitted-card h3 {
		margin-top: 0.4rem;
		overflow-wrap: anywhere;
		font-size: 1.2rem;
	}

	.uncommitted-card h3 a {
		color: var(--ink);
		text-decoration: none;
	}

	.uncommitted-card h3 a:hover {
		text-decoration: underline;
	}

	.uncommitted-card h3 a:focus-visible,
	.continue-link:focus-visible,
	.uncommitted-card button:focus-visible,
	.pending-state button:focus-visible {
		outline: 2px solid var(--gold-light);
		outline-offset: 3px;
	}

	.phase-badge {
		display: inline-flex;
		padding: 0.18rem 0.4rem;
		border: 1px solid rgb(154 120 67 / 38%);
		border-radius: 999px;
		color: var(--ink-soft);
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.phase-badge.review {
		border-color: rgb(53 116 75 / 40%);
		background: rgb(53 116 75 / 9%);
		color: #2f6843;
	}

	.phase-badge.committing {
		background: rgb(154 120 67 / 10%);
	}

	.uncommitted-card-footer {
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		margin-top: auto;
	}

	.uncommitted-card time {
		color: var(--ink-soft);
		font-size: 0.72rem;
	}

	.uncommitted-actions,
	.discard-confirmation > div {
		gap: 0.45rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.continue-link,
	.uncommitted-card button {
		min-height: 2.75rem;
		padding: 0.5rem 0.65rem;
		border-radius: 2px;
		font: inherit;
		font-size: 0.74rem;
		font-weight: 750;
	}

	.continue-link {
		display: inline-flex;
		align-items: center;
		border: 1px solid #353129;
		background: #fffaf0;
		color: var(--ink);
		text-decoration: none;
	}

	.uncommitted-card button {
		border: 1px solid rgb(154 68 57 / 55%);
		background: transparent;
		color: #8b2f27;
		cursor: pointer;
	}

	.uncommitted-card button:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.discard-confirmation {
		display: grid;
		gap: 0.65rem;
		padding-top: 0.8rem;
		border-top: 1px solid rgb(154 68 57 / 26%);
	}

	.discard-confirmation p {
		color: var(--ink-soft);
		font-size: 0.78rem;
	}

	.discard-confirmation .confirm-discard {
		background: #8b2f27;
		color: #fffaf0;
	}

	.discard-confirmation .discard-error {
		color: #8b2f27;
	}

	.pending-state {
		padding: 1rem;
		border: 1px solid rgb(154 120 67 / 32%);
		background: rgb(255 248 232 / 60%);
		color: var(--ink-soft);
	}

	.pending-state.error {
		display: grid;
		gap: 0.2rem;
		color: #8b2f27;
	}

	.pending-state button {
		width: fit-content;
		min-height: 2.75rem;
		margin-top: 0.45rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid currentcolor;
		border-radius: 2px;
		background: #fffaf0;
		color: #8b2f27;
		font: inherit;
		font-size: 0.74rem;
		font-weight: 750;
		cursor: pointer;
	}

	.pending-state button:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.document-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
		gap: 1.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.document-list li {
		padding: 0;
		border: none;
		background: none;
		box-shadow: none;
	}

	.document-card {
		display: flex;
		height: 11rem;
		padding: 1.05rem 1.15rem 1.15rem;
		flex-direction: column;
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 76%);
		box-shadow: 0.2rem 0.2rem 0 rgb(61 56 47 / 88%);
		color: inherit;
		text-decoration: none;
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease,
			transform 150ms ease;
	}

	.document-card:hover {
		background: #fffaf0;
		box-shadow: 0.3rem 0.3rem 0 #3d382f;
		transform: translate(-1px, -1px);
	}

	.document-card:focus-visible {
		border-color: #9a7843;
		outline: 2px solid #c8aa75;
		outline-offset: 3px;
	}

	.document-list h3 {
		display: -webkit-box;
		margin-top: auto;
		overflow-wrap: anywhere;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 1.25rem;
		line-height: 1.2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.document-list p {
		display: -webkit-box;
		margin-top: 0.3rem;
		overflow-wrap: anywhere;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink-soft);
		font-size: 0.85rem;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.card-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.card-icon {
		position: relative;
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 2px solid #282016;
		background: #fffaf0;
		color: #3d382f;
	}

	.card-icon img {
		width: 2rem;
		height: 2rem;
		object-fit: contain;
	}

	.card-icon-corner {
		position: absolute;
		z-index: 1;
		width: 0.4rem;
		height: 0.4rem;
		border: 1.5px solid #282016;
		border-radius: 1px;
		background: #65cfc9;
		transform: rotate(45deg);
	}

	.card-icon-corner.top-left {
		top: -0.25rem;
		left: -0.25rem;
	}

	.card-icon-corner.top-right {
		top: -0.25rem;
		right: -0.25rem;
	}

	.card-icon-corner.bottom-left {
		bottom: -0.25rem;
		left: -0.25rem;
	}

	.card-icon-corner.bottom-right {
		right: -0.25rem;
		bottom: -0.25rem;
	}

	.card-icon :global(svg),
	.card-arrow :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.card-arrow {
		display: inline-flex;
		color: #8b6b37;
	}

	.state-panel {
		display: grid;
		gap: 0.3rem;
		padding: 1.6rem;
		border: 1px solid rgb(194 155 91 / 58%);
		border-radius: 0.75rem;
		background: linear-gradient(145deg, #fff9ed, #f3e6d2);
		box-shadow: 0 0.8rem 1.8rem rgb(9 18 14 / 24%);
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
</style>
