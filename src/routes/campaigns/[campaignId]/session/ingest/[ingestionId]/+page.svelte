<script lang="ts">
	import Icon from '@iconify/svelte'
	import { goto } from '$app/navigation'
	import type { PageProps } from './$types'
	import { buildSessionRecap } from '#lib/ingestion.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { DocumentType } from '#lib/document.js'
	import type { SessionProposal, SessionProposalResolution } from '#lib/server/ingestion/types.js'
	import { commitSessionIngestion, getSessionIngestion } from '../../../data.remote'

	let { params }: PageProps = $props()

	const draft = $derived(
		getSessionIngestion({ campaignId: params.campaignId, ingestionId: params.ingestionId })
	)
	let selections = $state<Record<string, boolean>>({})
	let resolutions = $state<Record<string, string>>({})
	let committing = $state(false)
	let commitError = $state('')

	type ReviewDocumentType = Exclude<DocumentType, 'session'>

	const reviewTypes: ReviewDocumentType[] = ['npc', 'player', 'location', 'item', 'event', 'lore']
	const singularTypeLabel: Record<ReviewDocumentType, string> = {
		player: 'Player',
		npc: 'NPC',
		location: 'Location',
		item: 'Item',
		lore: 'Lore',
		event: 'Event'
	}

	const normalizeComparable = (value: string) =>
		value
			.trim()
			.toLocaleLowerCase()
			.replace(/^#+\s*/u, '')
			.replace(/[.!?:;]+$/u, '')
			.replace(/\s+/gu, ' ')

	const hasPossibleMatches = (proposal: SessionProposal) =>
		proposal.match.kind === 'unresolved' && proposal.match.candidates.length > 0

	const selected = (proposal: SessionProposal) => {
		if (proposal.documentType === 'session') return true
		if (proposal.operation === 'mention-only') return false
		if (hasPossibleMatches(proposal) && !resolutions[proposal.proposalId]) return false
		return selections[proposal.proposalId] ?? proposal.selected
	}

	const toggle = (proposal: SessionProposal) => {
		selections[proposal.proposalId] = !selected(proposal)
	}

	const chooseResolution = (proposal: SessionProposal, value: string) => {
		resolutions[proposal.proposalId] = value
		selections[proposal.proposalId] = Boolean(value)
	}

	const resolutionFor = (proposal: SessionProposal): SessionProposalResolution | undefined => {
		const value = resolutions[proposal.proposalId]
		if (!value) return undefined
		return value === 'create'
			? { proposalId: proposal.proposalId, kind: 'create' }
			: { proposalId: proposal.proposalId, kind: 'existing', documentId: value }
	}

	const isOtherDetail = (proposal: SessionProposal) =>
		proposal.operation === 'mention-only' || proposal.operation === 'record-only'

	const needsAttention = (proposal: SessionProposal) =>
		proposal.documentType !== 'session' &&
		!isOtherDetail(proposal) &&
		(hasPossibleMatches(proposal) ||
			proposal.certainty === 'inferred' ||
			proposal.resolutionMethod === 'model')

	const pendingAttention = (proposal: SessionProposal) =>
		(hasPossibleMatches(proposal) && !resolutions[proposal.proposalId]) ||
		((proposal.certainty === 'inferred' || proposal.resolutionMethod === 'model') &&
			!selected(proposal))

	const loreProposals = () =>
		draft.current?.proposals.filter(
			(proposal) => proposal.documentType !== 'session' && !isOtherDetail(proposal)
		) ?? []

	const attentionProposals = () => loreProposals().filter(needsAttention)
	const groupedProposals = (type: ReviewDocumentType) =>
		loreProposals().filter((proposal) => proposal.documentType === type && !needsAttention(proposal))
	const otherDetails = () => draft.current?.proposals.filter(isOtherDetail) ?? []
	const typeCount = (type: ReviewDocumentType) =>
		loreProposals().filter((proposal) => proposal.documentType === type).length
	const selectedLoreCount = () => loreProposals().filter(selected).length
	const pendingAttentionCount = () => attentionProposals().filter(pendingAttention).length

	const setGroupSelected = (proposals: SessionProposal[], value: boolean) => {
		for (const proposal of proposals) {
			if (hasPossibleMatches(proposal) && !resolutions[proposal.proposalId]) continue
			selections[proposal.proposalId] = value
		}
	}

	const recapContent = () => {
		if (!draft.current) return ''
		return buildSessionRecap(draft.current.title, draft.current.proposals.filter(selected))
			.replace(/^#\s+[^\r\n]*(?:\r?\n+|$)/u, '')
			.trim()
	}

	const recapParagraphs = () =>
		recapContent()
			.split(/\r?\n\s*\r?\n/u)
			.map((paragraph) => paragraph.trim())
			.filter(Boolean)

	const contentParts = (proposal: SessionProposal) =>
		proposal.content
			.split(/\r?\n\s*\r?\n/u)
			.map((part) => part.trim())
			.filter(
				(part) => Boolean(part) && normalizeComparable(part) !== normalizeComparable(proposal.title)
			)

	const actionLabel = (proposal: SessionProposal) => {
		if (proposal.operation === 'create-event') return 'New event'
		if (proposal.operation === 'create-entity')
			return `New ${singularTypeLabel[proposal.documentType as ReviewDocumentType].toLocaleLowerCase()}`
		if (proposal.operation === 'update-canon')
			return `Update ${singularTypeLabel[proposal.documentType as ReviewDocumentType].toLocaleLowerCase()}`
		if (proposal.operation === 'record-only') return 'Session detail'
		return 'Mention only'
	}

	const approve = async () => {
		if (!draft.current || committing) return
		committing = true
		commitError = ''
		try {
			const selectedProposals = draft.current.proposals.filter(selected)
			const result = await commitSessionIngestion({
				campaignId: params.campaignId,
				ingestionId: params.ingestionId,
				selectedProposalIds: selectedProposals.map(({ proposalId }) => proposalId),
				resolutions: selectedProposals
					.map(resolutionFor)
					.filter((resolution): resolution is SessionProposalResolution => Boolean(resolution))
			})
			await goto(`/campaigns/${params.campaignId}/session/${result.sessionDocumentId}`)
		} catch {
			commitError = 'The selection could not be saved. Refresh the analysis and try again.'
		} finally {
			committing = false
		}
	}
</script>

<svelte:head><title>Review session | Loremaster</title></svelte:head>

{#snippet sourceDetails(proposal: SessionProposal)}
	{#if proposal.evidence.length}
		<details class="sources">
			<summary>
				<Icon icon="lucide:quote" aria-hidden="true" />
				{proposal.evidence.length === 1 ? 'View source' : `${proposal.evidence.length} sources`}
			</summary>
			<div class="source-list">
				{#each proposal.evidence as evidence}
					<blockquote>
						{evidence.excerpt}
						<footer>Transcript lines {evidence.startLine}–{evidence.endLine}</footer>
					</blockquote>
				{/each}
			</div>
		</details>
	{/if}
{/snippet}

{#snippet proposalCard(proposal: SessionProposal)}
	{@const parts = contentParts(proposal)}
	{@const canToggle = !hasPossibleMatches(proposal) || Boolean(resolutions[proposal.proposalId])}
	<article class="proposal-card" class:unselected={!selected(proposal)}>
		<div class="proposal-heading">
			<label class="selection-control">
				<input
					type="checkbox"
					checked={selected(proposal)}
					disabled={!canToggle}
					onchange={() => toggle(proposal)}
				/>
				<span class="type-icon" aria-hidden="true">
					<Icon icon={documentTypeMetadata[proposal.documentType].icon} />
				</span>
				<span class="proposal-title">
					<span class="action-label">{actionLabel(proposal)}</span>
					<strong>{proposal.title}</strong>
				</span>
			</label>

			<div class="badges">
				{#if !selected(proposal) && canToggle}<span class="badge muted">Skipped</span>{/if}
				{#if proposal.certainty === 'inferred'}<span class="badge attention">Inferred</span>{/if}
				{#if proposal.resolutionMethod === 'model'}<span class="badge attention">Suggested match</span>{/if}
			</div>
		</div>

		{#if parts.length === 1}
			<p class="proposal-copy">{parts[0]}</p>
		{:else if parts.length > 1}
			<div class="additions">
				<span class="mini-label">Proposed additions</span>
				<ul>
					{#each parts as part}<li>{part}</li>{/each}
				</ul>
			</div>
		{/if}

		{#if proposal.match.kind === 'exact' && proposal.resolutionMethod === 'model'}
			<p class="match-note">
				<Icon icon="lucide:git-merge" aria-hidden="true" />
				Suggested match: <strong>{proposal.match.title}</strong>. Approve only if this is the same entry.
			</p>
		{:else if proposal.match.kind === 'unresolved' && proposal.match.candidates.length}
			<div class="resolution-panel">
				<div>
					<strong>Which Lore entry is this?</strong>
					<p>Choose an existing entry, create a new one, or leave it unresolved to skip it.</p>
				</div>
				<label class="resolution">
					<span>Resolve match</span>
					<select
						value={resolutions[proposal.proposalId] ?? ''}
						onchange={(event) => chooseResolution(proposal, event.currentTarget.value)}
					>
						<option value="">Skip for now</option>
						{#each proposal.match.candidates as candidate}
							<option value={candidate.documentId}>Update “{candidate.title}”</option>
						{/each}
						{#if proposal.canCreate}
							<option value="create">Create new “{proposal.title}”</option>
						{/if}
					</select>
				</label>
			</div>
		{/if}

		{#if proposal.certainty === 'inferred'}
			<p class="guidance">
				<Icon icon="lucide:sparkles" aria-hidden="true" />
				This is an inference rather than something stated directly in the session, so it is skipped by default.
			</p>
		{/if}

		{@render sourceDetails(proposal)}
	</article>
{/snippet}

{#snippet otherDetail(proposal: SessionProposal)}
	{@const parts = contentParts(proposal)}
	<article class="detail-card" class:unselected={!selected(proposal)}>
		<div class="detail-heading">
			{#if proposal.operation === 'record-only'}
				<label>
					<input type="checkbox" checked={selected(proposal)} onchange={() => toggle(proposal)} />
					<span>{actionLabel(proposal)}</span>
				</label>
			{:else}
				<span class="detail-kind">Mention only</span>
			{/if}
			<strong>{proposal.title}</strong>
		</div>
		{#if parts.length}
			<p>{parts.join(' ')}</p>
		{/if}
		<p class="detail-help">
			{proposal.operation === 'record-only'
				? 'Included in the session recap, but it will not create or update a Lore entry.'
				: 'Kept as source context only. It will not change Lore or the session recap.'}
		</p>
		{@render sourceDetails(proposal)}
	</article>
{/snippet}

<section class="review-page" aria-labelledby="review-heading">
	<a class="back-link" href={`/campaigns/${params.campaignId}/session`}>← Back to sessions</a>
	<header class="page-heading">
		<p class="eyebrow">Session review</p>
		<h2 id="review-heading">{draft.current?.title ?? 'Review session'}</h2>
		<p>Review what Loremaster learned before adding it to your campaign Lore.</p>
	</header>

	{#if draft.error}
		<p class="state error" role="alert">Unable to load this analysis.</p>
	{:else if !draft.current}
		<p class="state" role="status">Loading analysis…</p>
	{:else}
		<section class="recap" aria-labelledby="recap-heading">
			<div class="section-kicker">
				<Icon icon="lucide:notebook-text" aria-hidden="true" />
				<span>Session recap</span>
			</div>
			<h3 id="recap-heading">What happened</h3>
			<div class="recap-copy">
				{#if recapParagraphs().length}
					{#each recapParagraphs() as paragraph}<p>{paragraph}</p>{/each}
				{:else}
					<p class="empty-copy">No recap details are currently selected.</p>
				{/if}
			</div>
			<p class="recap-help">This recap updates as you include or skip details below.</p>
		</section>

		{#if loreProposals().length}
			<section class="found-overview" aria-labelledby="found-heading">
				<div>
					<p class="eyebrow">Lore changes</p>
					<h3 id="found-heading">Found in this session</h3>
				</div>
				<div class="type-counts">
					{#each reviewTypes as type}
						{#if typeCount(type)}
							<span>
								<Icon icon={documentTypeMetadata[type].icon} aria-hidden="true" />
								{documentTypeMetadata[type].label} · {typeCount(type)}
							</span>
						{/if}
					{/each}
				</div>
			</section>
		{/if}

		{#if attentionProposals().length}
			<section class="attention-section" aria-labelledby="attention-heading">
				<header class="group-heading attention-heading">
					<div>
						<div class="section-kicker attention-kicker">
							<Icon icon="lucide:circle-help" aria-hidden="true" />
							<span>Needs your attention</span>
						</div>
						<h3 id="attention-heading">
							{pendingAttentionCount()
								? `${pendingAttentionCount()} ${pendingAttentionCount() === 1 ? 'suggestion' : 'suggestions'} unresolved`
								: 'All suggestions reviewed'}
						</h3>
					</div>
					<p>These matches or inferences need a little more judgment than routine Lore updates.</p>
				</header>
				<div class="proposal-list attention-list">
					{#each attentionProposals() as proposal (proposal.proposalId)}
						{@render proposalCard(proposal)}
					{/each}
				</div>
			</section>
		{/if}

		{#each reviewTypes as type}
			{@const proposals = groupedProposals(type)}
			{#if proposals.length}
				<section class="proposal-group" aria-labelledby={`group-${type}`}>
					<header class="group-heading">
						<div class="group-title">
							<span class="group-icon" aria-hidden="true">
								<Icon icon={documentTypeMetadata[type].icon} />
							</span>
							<div>
								<h3 id={`group-${type}`}>{documentTypeMetadata[type].label}</h3>
								<p>{proposals.length} {proposals.length === 1 ? 'change' : 'changes'}</p>
							</div>
						</div>
						<div class="group-actions">
							<button type="button" onclick={() => setGroupSelected(proposals, true)}>Select all</button>
							<button type="button" onclick={() => setGroupSelected(proposals, false)}>Skip all</button>
						</div>
					</header>
					<div class="proposal-list">
						{#each proposals as proposal (proposal.proposalId)}
							{@render proposalCard(proposal)}
						{/each}
					</div>
				</section>
			{/if}
		{/each}

		{#if otherDetails().length}
			<details class="other-details">
				<summary>
					<span>
						<Icon icon="lucide:list-collapse" aria-hidden="true" />
						Other detected details
					</span>
					<small>{otherDetails().length}</small>
				</summary>
				<p class="other-details-intro">
					These details help preserve session context but do not create or update Lore entries.
				</p>
				<div class="detail-list">
					{#each otherDetails() as proposal (proposal.proposalId)}
						{@render otherDetail(proposal)}
					{/each}
				</div>
			</details>
		{/if}

		{#if draft.current.warnings.length}
			<details class="analysis-notes">
				<summary>{draft.current.warnings.length} analysis {draft.current.warnings.length === 1 ? 'note' : 'notes'}</summary>
				<p>Some source details could not be confidently included. These notes are mainly useful for troubleshooting.</p>
				<ul>
					{#each draft.current.warnings as warning}<li>{warning}</li>{/each}
				</ul>
			</details>
		{/if}

		<footer class="approval">
			<div>
				<strong>{selectedLoreCount()} Lore {selectedLoreCount() === 1 ? 'change' : 'changes'} selected</strong>
				<p>
					{pendingAttentionCount()
						? `${pendingAttentionCount()} ${pendingAttentionCount() === 1 ? 'suggestion is' : 'suggestions are'} still unresolved and will be skipped unless you review them.`
						: 'Everything that needs your judgment has been reviewed.'}
				</p>
				{#if commitError}<p class="error" role="alert">{commitError}</p>{/if}
			</div>
			<button type="button" disabled={committing} onclick={approve}>
				{committing ? 'Saving…' : 'Approve Lore changes'}
			</button>
		</footer>
	{/if}
</section>

<style>
	.review-page {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		--paper: rgb(255 251 241 / 82%);
		box-sizing: border-box;
		width: min(72rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 6vw, 5rem) 7rem;
		color: var(--ink);
	}

	.back-link,
	.eyebrow {
		color: var(--gold);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.page-heading {
		margin: 1.25rem 0 1.5rem;
	}

	h2,
	h3 {
		font-family: var(--font-display);
	}

	h2 {
		margin: 0.2rem 0 0.5rem;
		font-size: clamp(2rem, 5vw, 3rem);
	}

	h3 {
		margin: 0;
		font-size: 1.45rem;
	}

	.page-heading > p:last-child,
	.group-heading p,
	.recap-help,
	.match-note,
	.guidance,
	.other-details-intro,
	.analysis-notes > p,
	.approval p,
	.empty-copy {
		color: var(--ink-soft);
	}

	.state {
		padding: 1rem;
		border: 1px solid rgb(154 120 67 / 40%);
		background: rgb(250 241 222 / 55%);
	}

	.recap {
		margin: 1.75rem 0 2rem;
		padding: clamp(1.2rem, 3vw, 1.75rem);
		border: 1px solid rgb(154 120 67 / 42%);
		border-radius: var(--border-radius-md);
		background: var(--paper);
		box-shadow: 0 8px 28px rgb(70 49 28 / 5%);
	}

	.section-kicker {
		display: flex;
		gap: 0.45rem;
		align-items: center;
		margin-bottom: 0.35rem;
		color: var(--gold);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.section-kicker :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.recap-copy {
		margin-top: 1rem;
		font-size: 0.98rem;
		line-height: 1.65;
	}

	.recap-copy p {
		margin: 0.65rem 0;
	}

	.recap-help {
		margin: 1rem 0 0;
		font-size: 0.78rem;
	}

	.found-overview {
		display: flex;
		gap: 1rem 2rem;
		align-items: end;
		justify-content: space-between;
		margin: 2rem 0 1.35rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgb(154 120 67 / 30%);
	}

	.found-overview .eyebrow {
		margin: 0 0 0.2rem;
	}

	.type-counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		justify-content: flex-end;
	}

	.type-counts span {
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		padding: 0.35rem 0.55rem;
		border: 1px solid rgb(154 120 67 / 28%);
		border-radius: 999px;
		background: rgb(255 251 241 / 55%);
		color: var(--ink-soft);
		font-size: 0.75rem;
		font-weight: 650;
	}

	.type-counts :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.attention-section,
	.proposal-group {
		margin-top: 2rem;
	}

	.attention-section {
		padding: 1.15rem;
		border: 1px solid rgb(166 112 53 / 38%);
		border-radius: var(--border-radius-md);
		background: rgb(249 235 207 / 34%);
	}

	.group-heading {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.85rem;
	}

	.group-heading p {
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
	}

	.attention-heading {
		align-items: end;
	}

	.attention-heading > p {
		max-width: 29rem;
		text-align: right;
	}

	.attention-kicker {
		color: #9b642f;
	}

	.group-title {
		display: flex;
		gap: 0.7rem;
		align-items: center;
	}

	.group-icon,
	.type-icon {
		display: grid;
		place-items: center;
		border: 1px solid rgb(154 120 67 / 30%);
		border-radius: 50%;
		background: rgb(154 120 67 / 8%);
		color: var(--gold);
	}

	.group-icon {
		width: 2.35rem;
		height: 2.35rem;
	}

	.group-icon :global(svg) {
		width: 1.15rem;
		height: 1.15rem;
	}

	.type-icon {
		flex: 0 0 auto;
		width: 2rem;
		height: 2rem;
	}

	.type-icon :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.group-actions {
		display: flex;
		gap: 0.4rem;
	}

	.group-actions button {
		padding: 0.35rem 0.5rem;
		border: 0;
		background: transparent;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
	}

	.group-actions button:hover {
		color: var(--ink);
		text-decoration: underline;
	}

	.proposal-list {
		display: grid;
		gap: 0.65rem;
	}

	.proposal-card {
		padding: 1rem 1.05rem;
		border: 1px solid rgb(154 120 67 / 32%);
		border-radius: var(--border-radius-md);
		background: rgb(255 251 241 / 70%);
		transition:
			opacity 140ms ease,
			background-color 140ms ease,
			border-color 140ms ease;
	}

	.proposal-card.unselected {
		border-color: rgb(123 110 92 / 22%);
		background: rgb(246 242 233 / 45%);
	}

	.proposal-card.unselected > :not(.proposal-heading) {
		opacity: 0.7;
	}

	.proposal-heading {
		display: flex;
		gap: 0.9rem;
		align-items: start;
		justify-content: space-between;
	}

	.selection-control {
		display: flex;
		min-width: 0;
		gap: 0.65rem;
		align-items: center;
		cursor: pointer;
	}

	.selection-control input {
		flex: 0 0 auto;
	}

	.selection-control:has(input:disabled) {
		cursor: default;
	}

	.proposal-title {
		display: grid;
		min-width: 0;
		gap: 0.08rem;
	}

	.proposal-title strong {
		font-family: var(--font-display);
		font-size: 1.18rem;
		line-height: 1.2;
	}

	.action-label,
	.mini-label,
	.detail-kind {
		color: var(--gold);
		font-size: 0.67rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.badges {
		display: flex;
		flex: 0 0 auto;
		flex-wrap: wrap;
		gap: 0.3rem;
		justify-content: flex-end;
	}

	.badge {
		padding: 0.18rem 0.4rem;
		border: 1px solid rgb(154 120 67 / 30%);
		border-radius: 999px;
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.badge.attention {
		border-color: rgb(166 112 53 / 40%);
		background: rgb(206 150 78 / 10%);
		color: #8d5a26;
	}

	.badge.muted {
		border-color: rgb(105 95 83 / 24%);
		color: #776c5f;
	}

	.proposal-copy,
	.additions,
	.match-note,
	.guidance,
	.resolution-panel,
	.sources {
		margin-left: 3.55rem;
	}

	.proposal-copy {
		margin-top: 0.75rem;
		margin-bottom: 0;
		line-height: 1.55;
	}

	.additions {
		margin-top: 0.8rem;
	}

	.additions ul {
		display: grid;
		gap: 0.35rem;
		margin: 0.35rem 0 0;
		padding-left: 1.15rem;
	}

	.match-note,
	.guidance {
		display: flex;
		gap: 0.45rem;
		align-items: start;
		margin-top: 0.75rem;
		margin-bottom: 0;
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.match-note :global(svg),
	.guidance :global(svg) {
		flex: 0 0 auto;
		width: 0.95rem;
		height: 0.95rem;
		margin-top: 0.08rem;
	}

	.resolution-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(13rem, 22rem);
		gap: 1rem;
		align-items: end;
		margin-top: 0.85rem;
		padding: 0.8rem;
		border: 1px solid rgb(166 112 53 / 35%);
		border-radius: calc(var(--border-radius-md) * 0.8);
		background: rgb(255 248 232 / 70%);
	}

	.resolution-panel p {
		margin: 0.2rem 0 0;
		color: var(--ink-soft);
		font-size: 0.76rem;
	}

	.resolution {
		display: grid;
		gap: 0.3rem;
		color: var(--ink-soft);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.resolution select {
		width: 100%;
		padding: 0.5rem 0.6rem;
		border: 1px solid rgb(154 120 67 / 48%);
		border-radius: 0.35rem;
		background: #fffaf0;
		color: var(--ink);
		font: inherit;
	}

	.sources {
		margin-top: 0.85rem;
	}

	.sources summary {
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		color: var(--ink-soft);
		font-size: 0.74rem;
		font-weight: 700;
		cursor: pointer;
		list-style: none;
	}

	.sources summary::-webkit-details-marker {
		display: none;
	}

	.sources summary :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.source-list {
		margin-top: 0.65rem;
	}

	blockquote {
		margin: 0.55rem 0;
		padding: 0.65rem 0.85rem;
		border-left: 3px solid rgb(154 120 67 / 58%);
		background: rgb(255 251 241 / 68%);
		font-size: 0.82rem;
		line-height: 1.5;
	}

	blockquote footer {
		margin-top: 0.35rem;
		color: var(--ink-soft);
		font-size: 0.68rem;
	}

	.other-details,
	.analysis-notes {
		margin-top: 2rem;
		border-top: 1px solid rgb(154 120 67 / 28%);
	}

	.other-details > summary,
	.analysis-notes > summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 0;
		color: var(--ink-soft);
		font-weight: 700;
		cursor: pointer;
	}

	.other-details > summary span {
		display: flex;
		gap: 0.45rem;
		align-items: center;
	}

	.other-details > summary :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.other-details-intro {
		margin: 0 0 0.8rem;
		font-size: 0.8rem;
	}

	.detail-list {
		display: grid;
		gap: 0.5rem;
	}

	.detail-card {
		padding: 0.8rem 0.9rem;
		border: 1px solid rgb(154 120 67 / 24%);
		border-radius: calc(var(--border-radius-md) * 0.8);
		background: rgb(255 251 241 / 44%);
	}

	.detail-card.unselected {
		opacity: 0.68;
	}

	.detail-heading {
		display: flex;
		gap: 0.65rem;
		align-items: center;
	}

	.detail-heading label {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}

	.detail-heading strong {
		font-family: var(--font-display);
	}

	.detail-card > p {
		margin: 0.5rem 0 0;
		font-size: 0.82rem;
	}

	.detail-help {
		color: var(--ink-soft);
		font-style: italic;
	}

	.detail-card .sources {
		margin-left: 0;
	}

	.analysis-notes {
		font-size: 0.78rem;
	}

	.analysis-notes ul {
		margin-top: 0.5rem;
	}

	.error {
		color: #8b2f27;
	}

	.approval {
		position: sticky;
		z-index: 10;
		bottom: 1rem;
		display: flex;
		gap: 1.5rem;
		align-items: center;
		justify-content: space-between;
		margin-top: 2rem;
		padding: 0.95rem 1rem;
		border: 1px solid rgb(154 120 67 / 48%);
		border-radius: var(--border-radius-md);
		background: rgb(255 251 241 / 94%);
		box-shadow: 0 10px 30px rgb(50 35 20 / 12%);
		backdrop-filter: blur(10px);
	}

	.approval p {
		margin: 0.2rem 0 0;
		font-size: 0.76rem;
	}

	.approval button {
		flex: 0 0 auto;
		padding: 0.7rem 0.95rem;
		border: 1px solid var(--gold);
		border-radius: 0.4rem;
		background: var(--ink);
		color: #fffaf0;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.approval button:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	@media (max-width: 720px) {
		.found-overview,
		.group-heading,
		.attention-heading,
		.approval {
			align-items: stretch;
			flex-direction: column;
		}

		.type-counts,
		.group-actions {
			justify-content: flex-start;
		}

		.attention-heading > p {
			max-width: none;
			text-align: left;
		}

		.resolution-panel {
			grid-template-columns: 1fr;
		}

		.proposal-copy,
		.additions,
		.match-note,
		.guidance,
		.resolution-panel,
		.sources {
			margin-left: 0;
		}

		.approval {
			bottom: 0.5rem;
		}

		.approval button {
			width: 100%;
		}
	}
</style>
