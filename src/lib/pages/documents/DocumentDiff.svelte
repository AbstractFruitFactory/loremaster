<script lang="ts">
	import type { RevisionDiff, RevisionDiffLine } from '#lib/server/vault/revisions/types.js'

	type Props = {
		diff: RevisionDiff | undefined
		isLoading: boolean
		hasLoadError: boolean
	}

	type DiffRow = RevisionDiffLine & {
		beforeLine: number | undefined
		afterLine: number | undefined
	}

	let { diff, isLoading, hasLoadError }: Props = $props()

	const rows = $derived.by(() => {
		if (!diff) return []

		const flattened: DiffRow[] = []

		for (const hunk of diff.hunks) {
			let beforeLine = hunk.oldStart - 1
			let afterLine = hunk.newStart - 1

			for (const line of hunk.lines) {
				if (line.type !== 'added') beforeLine += 1
				if (line.type !== 'removed') afterLine += 1

				flattened.push({
					...line,
					beforeLine: line.type === 'added' ? undefined : beforeLine,
					afterLine: line.type === 'removed' ? undefined : afterLine
				})
			}
		}

		return flattened
	})
</script>

<section class="revision-diff" aria-labelledby="diff-heading">
	<header>
		<div>
			<p class="eyebrow">Line changes</p>
			<h3 id="diff-heading">Before and after</h3>
		</div>
		<div class="legend" aria-label="Diff legend">
			<span class="removed-key">Removed</span>
			<span class="added-key">Added</span>
		</div>
	</header>

	{#if hasLoadError}
		<div class="state-panel error" role="alert">
			<strong>Unable to compare this revision.</strong>
			<span>Select it again or reload the page.</span>
		</div>
	{:else if isLoading}
		<div class="state-panel" role="status" aria-live="polite">Comparing revisions…</div>
	{:else if rows.length}
		{#if diff?.truncated}
			<p class="truncation" role="status">
				Showing {rows.length} changed lines. {diff.omittedLineCount} additional lines were omitted.
			</p>
		{/if}
		<div class="diff-table" role="table" aria-label="Document line changes">
			<div class="diff-labels" role="row">
				<span role="columnheader">Before</span>
				<span role="columnheader">After</span>
				<span role="columnheader">Content</span>
			</div>
			{#each rows as row, index (`${row.type}-${row.beforeLine}-${row.afterLine}-${index}`)}
				<div class={['diff-row', row.type]} role="row">
					<span class="line-number" role="cell">{row.beforeLine ?? '–'}</span>
					<span class="line-number" role="cell">{row.afterLine ?? '–'}</span>
					<span class="line-content" role="cell">
						<code>
							{#if row.type === 'removed'}
								<del>{row.line || ' '}</del>
							{:else if row.type === 'added'}
								<ins>{row.line || ' '}</ins>
							{:else}
								<span>{row.line || ' '}</span>
							{/if}
						</code>
					</span>
				</div>
			{/each}
		</div>
	{:else}
		<div class="state-panel">
			<strong>No textual changes.</strong>
			<span>This revision has the same content as its predecessor.</span>
		</div>
	{/if}
</section>

<style>
	.revision-diff {
		min-width: 0;
		color: #282016;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: end;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	h3,
	p {
		margin: 0;
	}

	h3 {
		font-family: var(--font-display);
		font-size: 1.45rem;
	}

	.eyebrow {
		color: #9a7843;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.legend {
		display: flex;
		gap: 0.8rem;
		color: #6f604e;
		font-size: 0.75rem;
	}

	.legend span::before {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		margin-right: 0.3rem;
		border: 1px solid;
		content: '';
		vertical-align: -0.05rem;
	}

	.removed-key::before {
		border-color: #b66c62;
		background: #f3d8d1;
	}

	.added-key::before {
		border-color: #6f956d;
		background: #dcebd5;
	}

	.truncation {
		margin-bottom: 0.65rem;
		color: #6f604e;
		font-size: 0.78rem;
	}

	.diff-table {
		overflow-x: auto;
		border: 1px solid rgb(154 120 67 / 34%);
		background: rgb(255 250 239 / 52%);
	}

	.diff-labels,
	.diff-row {
		display: grid;
		grid-template-columns: 4rem 4rem minmax(20rem, 1fr);
	}

	.diff-labels {
		border-bottom: 1px solid rgb(154 120 67 / 28%);
		background: rgb(154 120 67 / 9%);
		color: #6f604e;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.diff-labels span,
	.diff-row > * {
		padding: 0.35rem 0.55rem;
	}

	.diff-labels span + span,
	.diff-row > * + * {
		border-left: 1px solid rgb(154 120 67 / 18%);
	}

	.diff-row + .diff-row {
		border-top: 1px solid rgb(154 120 67 / 12%);
	}

	.diff-row.removed {
		background: rgb(243 216 209 / 62%);
	}

	.diff-row.added {
		background: rgb(220 235 213 / 68%);
	}

	.line-number {
		color: #887662;
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.72rem;
		text-align: right;
		user-select: none;
	}

	.line-content {
		overflow-wrap: anywhere;
	}

	code {
		color: inherit;
		font-size: 0.78rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	del,
	ins {
		display: block;
		color: inherit;
		text-decoration: none;
	}

	.state-panel {
		display: grid;
		gap: 0.25rem;
		padding: 1.25rem;
		border: 1px dashed rgb(154 120 67 / 48%);
		background: rgb(250 240 219 / 42%);
		color: #6f604e;
		text-align: center;
	}

	.state-panel strong {
		color: #282016;
		font-family: var(--font-display);
		font-size: 1.15rem;
	}

	.state-panel.error,
	.state-panel.error strong {
		color: #8b2f27;
	}

	@media (max-width: 42rem) {
		.diff-labels,
		.diff-row {
			grid-template-columns: 2.8rem 2.8rem minmax(16rem, 1fr);
		}

		.diff-labels span,
		.diff-row > * {
			padding-inline: 0.4rem;
		}
	}
</style>
