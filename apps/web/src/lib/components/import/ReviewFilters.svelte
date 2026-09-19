<script lang="ts">
	import type { CampaignImportSource } from '#lib/server/ingestion/types.js'
	import type { ReviewStatusFilter } from '#lib/import/review-state.js'

	type Props = {
		sources: readonly CampaignImportSource[]
		sourceId: string
		status: ReviewStatusFilter
		onSourceChange: (sourceId: string) => void
		onStatusChange: (status: ReviewStatusFilter) => void
	}

	let { sources, sourceId, status, onSourceChange, onStatusChange }: Props = $props()

	const statusOptions: { value: ReviewStatusFilter; label: string }[] = [
		{ value: 'all', label: 'All decisions' },
		{ value: 'selected', label: 'Selected' },
		{ value: 'not-selected', label: 'Not selected' }
	]
</script>

<div class="filters" aria-label="Review filters">
	<fieldset>
		<legend>Source</legend>
		<label for="import-source-filter">Show proposals from</label>
		<select
			id="import-source-filter"
			value={sourceId}
			onchange={(event) => onSourceChange(event.currentTarget.value)}
		>
			<option value="all">All sources</option>
			{#each sources as source (source.sourceId)}
				<option value={source.sourceId}>{source.title}</option>
			{/each}
		</select>
	</fieldset>

	<fieldset>
		<legend>Status</legend>
		<div class="status-options">
			{#each statusOptions as option (option.value)}
				<label>
					<input
						type="radio"
						name="import-review-status"
						value={option.value}
						checked={status === option.value}
						onchange={() => onStatusChange(option.value)}
					/>
					<span>{option.label}</span>
				</label>
			{/each}
		</div>
	</fieldset>
</div>

<style>
	.filters {
		display: grid;
		grid-template-columns: minmax(13rem, 0.7fr) minmax(20rem, 1.3fr);
		gap: 1rem;
		padding: 1rem;
		border: 1px solid rgb(149 111 57 / 45%);
		background: rgb(255 249 237 / 82%);
	}

	fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.45rem;
		color: #6c5432;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	fieldset > label {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	select {
		box-sizing: border-box;
		width: 100%;
		padding: 0.55rem 0.65rem;
		border: 1px solid #927448;
		border-radius: 2px;
		background: #fffaf0;
		color: #30291f;
		font: inherit;
	}

	select:focus-visible,
	input:focus-visible + span {
		outline: 2px solid #c8aa75;
		outline-offset: 2px;
	}

	.status-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.status-options label {
		position: relative;
		cursor: pointer;
	}

	.status-options input {
		position: absolute;
		opacity: 0;
	}

	.status-options span {
		display: block;
		padding: 0.48rem 0.65rem;
		border: 1px solid #a38a62;
		border-radius: 999px;
		background: #fffaf0;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.status-options input:checked + span {
		border-color: #375e54;
		background: #dcece5;
		color: #24463e;
	}

	@media (max-width: 700px) {
		.filters {
			grid-template-columns: 1fr;
		}
	}
</style>
