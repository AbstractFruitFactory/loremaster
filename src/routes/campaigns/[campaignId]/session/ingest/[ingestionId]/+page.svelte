<script lang="ts">
	import type { PageProps } from './$types'
	import { goto } from '$app/navigation'
	import { buildSessionRecap } from '#lib/ingestion.js'
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
	const recapContent = () => {
		if (!draft.current) return ''
		return buildSessionRecap(draft.current.title, draft.current.proposals.filter(selected))
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
			commitError = 'The selection could not be committed. Refresh the analysis and try again.'
		} finally {
			committing = false
		}
	}
</script>

<svelte:head><title>Review session | Loremaster</title></svelte:head>

<section class="review-page" aria-labelledby="review-heading">
	<a class="back-link" href={`/campaigns/${params.campaignId}/session`}>← Back to sessions</a>
	<header>
		<p class="eyebrow">Canon review</p>
		<h2 id="review-heading">{draft.current?.title ?? 'Review session'}</h2>
		<p>Nothing changes campaign canon until you approve the selected proposals below.</p>
	</header>

	{#if draft.error}
		<p class="state error" role="alert">Unable to load this analysis.</p>
	{:else if !draft.current}
		<p class="state" role="status">Loading analysis…</p>
	{:else}
		{#if draft.current.warnings.length}
			<aside class="warnings" aria-label="Analysis warnings">
				<strong>Analysis warnings</strong>
				<ul>
					{#each draft.current.warnings as warning}<li>{warning}</li>{/each}
				</ul>
			</aside>
		{/if}

		<div class="proposal-list">
			{#each draft.current.proposals as proposal (proposal.proposalId)}
				<article class:unselected={!selected(proposal)}>
					<header class="proposal-heading">
						<label>
							<input
								type="checkbox"
								checked={selected(proposal)}
								disabled={proposal.documentType === 'session' ||
									proposal.operation === 'mention-only' ||
									(hasPossibleMatches(proposal) && !resolutions[proposal.proposalId])}
								onchange={() => toggle(proposal)}
							/>
							<span>{proposal.title}</span>
						</label>
						<div class="badges">
							<span>{proposal.operation}</span><span>{proposal.certainty}</span>
						</div>
					</header>
					<p class="content">
						{proposal.documentType === 'session' ? recapContent() : proposal.content}
					</p>
					{#if proposal.documentType === 'session'}
						<p class="guidance">This recap is rebuilt from the claims selected below.</p>
					{:else if proposal.operation === 'mention-only'}
						<p class="guidance">Mention-only claims are evidence context and never change canon.</p>
					{:else if proposal.certainty === 'inferred'}
						<p class="guidance">This inference is excluded unless you explicitly approve it.</p>
					{/if}

					{#if proposal.match.kind === 'exact'}
						<p class="match">Exact match: {proposal.match.title}</p>
					{:else if proposal.match.candidates.length && proposal.operation !== 'mention-only'}
						<label class="resolution">
							<span>Resolve possible match</span>
							<select
								value={resolutions[proposal.proposalId] ?? ''}
								onchange={(event) => chooseResolution(proposal, event.currentTarget.value)}
							>
								<option value="" disabled>Choose an existing document or create a new one</option>
								{#each proposal.match.candidates as candidate}
									<option value={candidate.documentId}>Update {candidate.title}</option>
								{/each}
								<option value="create">Create new “{proposal.title}”</option>
							</select>
						</label>
					{/if}

					{#if proposal.evidence.length}
						<details>
							<summary>Evidence ({proposal.evidence.length})</summary>
							{#each proposal.evidence as evidence}
								<blockquote>
									{evidence.excerpt}
									<footer>Lines {evidence.startLine}–{evidence.endLine}</footer>
								</blockquote>
							{/each}
						</details>
					{/if}
				</article>
			{/each}
		</div>
		<footer class="approval">
			<div>
				<strong>Ready to update canon?</strong>
				<p>The selected proposals will be applied to the campaign.</p>
				{#if commitError}<p class="error" role="alert">{commitError}</p>{/if}
			</div>
			<button type="button" disabled={committing} onclick={approve}>
				{committing ? 'Applying…' : 'Approve selected changes'}
			</button>
		</footer>
	{/if}
</section>

<style>
	.review-page {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		box-sizing: border-box;
		width: min(68rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 6vw, 5rem);
		color: var(--ink);
	}
	.back-link,
	.eyebrow {
		color: var(--gold);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}
	.review-page > header {
		margin: 1.25rem 0 1.5rem;
	}
	h2 {
		margin: 0.2rem 0 0.5rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3rem);
	}
	header p:last-child,
	.match {
		color: var(--ink-soft);
	}
	.warnings,
	.state {
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid rgb(154 120 67 / 40%);
		background: rgb(250 241 222 / 55%);
	}
	.warnings ul {
		margin: 0.5rem 0 0;
	}
	.proposal-list {
		display: grid;
		gap: 1rem;
	}
	article {
		padding: 1.15rem;
		border: 1px solid rgb(154 120 67 / 40%);
		background: rgb(250 241 222 / 68%);
	}
	article.unselected {
		opacity: 0.58;
	}
	.proposal-heading {
		display: flex;
		gap: 1rem;
		align-items: start;
		justify-content: space-between;
	}
	.proposal-heading label {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 700;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.badges span {
		padding: 0.2rem 0.45rem;
		border: 1px solid rgb(154 120 67 / 40%);
		color: var(--gold);
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
	}
	.content {
		white-space: pre-wrap;
	}
	.match {
		font-size: 0.85rem;
	}
	.guidance {
		color: var(--ink-soft);
		font-size: 0.82rem;
		font-style: italic;
	}
	.resolution {
		display: grid;
		gap: 0.35rem;
		margin: 0.8rem 0;
		color: var(--ink-soft);
		font-size: 0.82rem;
		font-weight: 700;
	}
	.resolution select {
		width: min(100%, 32rem);
		padding: 0.55rem 0.65rem;
		border: 1px solid rgb(154 120 67 / 55%);
		background: #fffaf0;
		color: var(--ink);
		font: inherit;
	}
	blockquote {
		margin: 0.7rem 0;
		padding: 0.7rem 1rem;
		border-left: 3px solid var(--gold);
		background: rgb(255 251 241 / 65%);
	}
	blockquote footer {
		margin-top: 0.4rem;
		color: var(--ink-soft);
		font-size: 0.75rem;
	}
	.error {
		color: #8b2f27;
	}
	.approval {
		display: flex;
		gap: 1.5rem;
		align-items: center;
		justify-content: space-between;
		margin-top: 1.5rem;
		padding: 1.2rem;
		border: 1px solid rgb(154 120 67 / 55%);
		background: rgb(255 251 241 / 85%);
	}
	.approval p {
		margin: 0.25rem 0 0;
		color: var(--ink-soft);
	}
	.approval button {
		flex: 0 0 auto;
		padding: 0.75rem 1rem;
		border: 1px solid var(--gold);
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
</style>
