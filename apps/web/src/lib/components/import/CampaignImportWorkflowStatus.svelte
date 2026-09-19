<script lang="ts">
	import Icon from '@iconify/svelte'
	import {
		campaignImportStageLabels,
		campaignImportStoppedAt
	} from '#lib/import/workflow-status.js'
	import type { CampaignImportWorkflowLifecycleStatus } from '#lib/server/campaign-import/lifecycle.js'

	type Props = {
		status: CampaignImportWorkflowLifecycleStatus
		activeTitle: string
		waitingText: string
		failureTitle: string
		failureText: string
		transportError?: boolean
		retry?: {
			label: string
			pending: boolean
			action: () => void
		}
	}

	let {
		status,
		activeTitle,
		waitingText,
		failureTitle,
		failureText,
		transportError = false,
		retry
	}: Props = $props()

	const failed = $derived(
		status.lifecycle === 'not-started' ||
			status.lifecycle === 'failed' ||
			status.lifecycle === 'cancelled'
	)
	const stage = $derived(status.progress?.stage ?? status.failedStage)
</script>

<div
	class={['state', failed && 'error-state']}
	role={failed ? 'alert' : 'status'}
	aria-live="polite"
>
	<Icon
		icon={failed
			? 'lucide:triangle-alert'
			: status.lifecycle === 'queued'
				? 'lucide:clock-3'
				: 'lucide:scan-search'}
		aria-hidden="true"
	/>
	<div>
		<strong>{failed ? failureTitle : activeTitle}</strong>
		<p>{failed ? failureText : stage ? campaignImportStageLabels[stage] : waitingText}</p>
		{#if failed && status.failedStage}
			<p class="failed-stage">{campaignImportStoppedAt(status.failedStage)}</p>
		{/if}
		{#if !failed && status.progress && status.progress.total > 0}
			<progress value={status.progress.completed} max={status.progress.total}>
				{status.progress.completed} of {status.progress.total}
			</progress>
		{/if}
		{#if failed && retry && status.retryable}
			<button type="button" disabled={retry.pending} onclick={retry.action}>
				{retry.pending ? 'Restarting…' : retry.label}
			</button>
		{/if}
	</div>
</div>

{#if transportError}
	<p class="transport-error" role="alert">
		The status connection was interrupted. Loremaster will keep trying.
	</p>
{/if}

<style>
	.state {
		display: flex;
		gap: 0.9rem;
		align-items: flex-start;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 94%);
		box-shadow: 0.25rem 0.25rem 0 #171d1a;
	}

	.state > :global(svg) {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		color: #9a7843;
	}

	.state div {
		display: grid;
		gap: 0.5rem;
	}

	.state p {
		margin: 0;
	}

	.state progress {
		width: min(24rem, 100%);
	}

	.error-state {
		border-color: #8d4037;
	}

	.failed-stage,
	.transport-error {
		color: #9b3d34;
	}

	.transport-error {
		margin: 0.75rem 0 0;
	}

	button {
		width: fit-content;
		padding: 0.6rem 0.85rem;
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: #f1c278;
		box-shadow: 0.15rem 0.15rem 0 #3d382f;
		color: #282016;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
</style>
