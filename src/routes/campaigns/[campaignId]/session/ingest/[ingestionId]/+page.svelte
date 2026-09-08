<script lang="ts">
	import type { PageProps } from './$types'
	import { getSessionIngestion } from '../../../data.remote'

	let { params }: PageProps = $props()
	const draft = $derived(
		getSessionIngestion({ campaignId: params.campaignId, ingestionId: params.ingestionId })
	)
	let selections = $state<Record<string, boolean>>({})

	const selected = (proposalId: string, initial: boolean) => selections[proposalId] ?? initial
	const toggle = (proposalId: string, initial: boolean) => {
		selections[proposalId] = !selected(proposalId, initial)
	}
</script>

<svelte:head><title>Review session | Loremaster</title></svelte:head>

<section class="review-page" aria-labelledby="review-heading">
	<a class="back-link" href={`/campaigns/${params.campaignId}/session`}>← Back to sessions</a>
	<header>
		<p class="eyebrow">Canon review</p>
		<h2 id="review-heading">{draft.current?.title ?? 'Review session'}</h2>
		<p>Nothing here changes campaign canon until the batch is approved in the next step.</p>
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
				<article class:unselected={!selected(proposal.proposalId, proposal.selected)}>
					<header class="proposal-heading">
						<label>
							<input
								type="checkbox"
								checked={selected(proposal.proposalId, proposal.selected)}
								disabled={proposal.documentType === 'session'}
								onchange={() => toggle(proposal.proposalId, proposal.selected)}
							/>
							<span>{proposal.title}</span>
						</label>
						<div class="badges">
							<span>{proposal.operation}</span><span>{proposal.certainty}</span>
						</div>
					</header>
					<p class="content">{proposal.content}</p>

					{#if proposal.match.kind === 'exact'}
						<p class="match">Exact match: {proposal.match.title}</p>
					{:else if proposal.match.candidates.length}
						<p class="match">
							Possible matches: {proposal.match.candidates.map(({ title }) => title).join(', ')}
						</p>
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
</style>
