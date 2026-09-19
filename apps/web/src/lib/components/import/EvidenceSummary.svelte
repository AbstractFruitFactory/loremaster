<script lang="ts">
	import type { CampaignImportSource, Evidence } from '#lib/server/ingestion/types.js'
	import {
		evidenceKey,
		excerptPreview,
		sourceTitleById,
		strongestEvidenceFirst
	} from '#lib/import/review-state.js'

	type Props = {
		evidence: readonly Evidence[]
		sources: readonly CampaignImportSource[]
	}

	let { evidence, sources }: Props = $props()

	const orderedEvidence = $derived(strongestEvidenceFirst(evidence))
	const sourceTitles = $derived(sourceTitleById(sources))
	const strongest = $derived(orderedEvidence[0])
	const remaining = $derived(orderedEvidence.slice(1))

	const sourceLabel = (item: Evidence) =>
		(item.sourceId && sourceTitles.get(item.sourceId)) ?? 'Imported source'
</script>

{#snippet excerpt(item: Evidence)}
	{@const preview = excerptPreview(item.excerpt)}
	<p>{preview.content}</p>
	{#if preview.truncated}
		<details class="full-excerpt">
			<summary>Read full excerpt</summary>
			<p>{item.excerpt}</p>
		</details>
	{/if}
{/snippet}

{#if strongest}
	<section class="evidence-summary" aria-label="Proposal evidence">
		<p class="label">Strongest evidence</p>
		<blockquote>
			{@render excerpt(strongest)}
			<footer>
				{sourceLabel(strongest)}, lines {strongest.startLine}–{strongest.endLine}
			</footer>
		</blockquote>

		{#if remaining.length}
			<details>
				<summary>
					{remaining.length} more {remaining.length === 1 ? 'source excerpt' : 'sources / evidence'}
				</summary>
				<div class="more-evidence">
					{#each remaining as item (evidenceKey(item))}
						<blockquote>
							{@render excerpt(item)}
							<footer>{sourceLabel(item)}, lines {item.startLine}–{item.endLine}</footer>
						</blockquote>
					{/each}
				</div>
			</details>
		{/if}
	</section>
{/if}

<style>
	.evidence-summary {
		display: grid;
		gap: 0.65rem;
	}

	.label {
		margin: 0;
		color: #77644b;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	blockquote {
		margin: 0;
		padding: 0.8rem 0.9rem;
		border-left: 3px solid #c39147;
		background: rgb(242 229 202 / 62%);
	}

	blockquote p,
	blockquote footer {
		margin: 0;
	}

	blockquote p {
		white-space: pre-wrap;
	}

	blockquote footer {
		margin-top: 0.45rem;
		color: #756650;
		font-size: 0.76rem;
	}

	details summary {
		width: fit-content;
		color: #6d542f;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
	}

	.full-excerpt {
		margin-top: 0.55rem;
	}

	.full-excerpt p {
		margin-top: 0.55rem;
		padding: 0.65rem;
		max-height: 24rem;
		overflow: auto;
		border: 1px solid rgb(148 113 65 / 42%);
		background: #fffaf0;
	}

	.more-evidence {
		display: grid;
		gap: 0.65rem;
		margin-top: 0.65rem;
	}
</style>
