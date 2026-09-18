<script lang="ts">
	import { goto } from '$app/navigation'
	import Button from '#lib/components/button/Button.svelte'
	import TextInput from '#lib/components/text-input/TextInput.svelte'
	import Textarea from '#lib/components/textarea/Textarea.svelte'
	import type { PageProps } from './$types'
	import { analyzeSession } from '../../data.remote'

	let { params }: PageProps = $props()
	let title = $state('')
	let transcript = $state('')
	let isStarting = $state(false)
	let analysisError = $state('')

	type AnalysisAttempt = {
		ingestionId: string
		title: string
		transcript: string
	}

	let retryAttempt: AnalysisAttempt | undefined

	const httpStatus = (error: unknown) => {
		if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
		return typeof error.status === 'number' ? error.status : undefined
	}

	const isUncertainTransportError = (error: unknown) => {
		const status = httpStatus(error)
		return status === undefined || status >= 500
	}

	const handleAnalyze = async (event: SubmitEvent) => {
		event.preventDefault()
		isStarting = true
		analysisError = ''
		const submittedTitle = title
		const submittedTranscript = transcript
		const ingestionId =
			retryAttempt?.title === submittedTitle && retryAttempt.transcript === submittedTranscript
				? retryAttempt.ingestionId
				: crypto.randomUUID()
		retryAttempt = undefined
		try {
			const reference = await analyzeSession({
				campaignId: params.campaignId,
				ingestionId,
				title: submittedTitle,
				transcript: submittedTranscript
			})
			await goto(`/campaigns/${params.campaignId}/session/ingest/${reference.ingestionId}`)
		} catch (error) {
			if (isUncertainTransportError(error)) {
				retryAttempt = { ingestionId, title: submittedTitle, transcript: submittedTranscript }
			}
			analysisError = error instanceof Error ? error.message : 'Unable to analyze this session'
		} finally {
			isStarting = false
		}
	}
</script>

<svelte:head><title>Ingest session | Loremaster</title></svelte:head>

<section class="ingest-page" aria-labelledby="ingest-heading">
	<a class="back-link" href={`/campaigns/${params.campaignId}/session`}>← Back to sessions</a>
	<header>
		<p class="eyebrow">Session ingestion</p>
		<h2 id="ingest-heading">Add a completed session</h2>
		<p>Paste the transcript. Loremaster will extract evidence-backed changes for review.</p>
	</header>

	<form
		onsubmit={handleAnalyze}
		aria-busy={isStarting}
		aria-describedby={analysisError ? 'analysis-error' : undefined}
	>
		<label for="session-title">
			<span>Session title</span>
			<TextInput id="session-title" bind:value={title} required maxlength={200} />
		</label>
		<label for="session-transcript">
			<span>Raw transcript</span>
			<Textarea id="session-transcript" bind:value={transcript} required rows={18} />
		</label>
		<Button type="submit" disabled={isStarting}>
			{isStarting ? 'Starting analysis…' : 'Analyze session'}
		</Button>
		<p class="submit-status" role="status" aria-live="polite" aria-atomic="true">
			{isStarting ? 'Starting analysis…' : ''}
		</p>
	</form>

	{#if analysisError}<p id="analysis-error" class="error" role="alert">{analysisError}</p>{/if}
</section>

<style>
	.ingest-page {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		box-sizing: border-box;
		width: min(64rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 6vw, 5rem);
		color: var(--ink);
	}
	.back-link,
	.eyebrow {
		color: #d7b46e;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}
	header {
		margin: 1.25rem 0 1.5rem;
		color: #f5ead6;
	}
	header p:last-child {
		color: #c9beaa;
	}
	h2 {
		margin: 0.2rem 0 0.5rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3rem);
	}
	form {
		display: grid;
		gap: 1rem;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1.5px solid #3d382f;
		border-radius: 2px;
		background: rgb(255 250 239 / 90%);
		box-shadow: 0.25rem 0.25rem 0 #171d1a;
	}
	label {
		display: grid;
		gap: 0.4rem;
		font-weight: 700;
	}
	.error {
		color: #8b2f27;
	}
	.submit-status {
		min-height: 1.2em;
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.8rem;
	}
</style>
