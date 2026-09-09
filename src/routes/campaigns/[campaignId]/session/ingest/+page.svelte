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
	let isAnalyzing = $state(false)
	let analysisError = $state('')

	const handleAnalyze = async (event: SubmitEvent) => {
		event.preventDefault()
		isAnalyzing = true
		analysisError = ''
		try {
			const draft = await analyzeSession({ campaignId: params.campaignId, title, transcript })
			await goto(`/campaigns/${params.campaignId}/session/ingest/${draft.ingestionId}`)
		} catch (error) {
			analysisError = error instanceof Error ? error.message : 'Unable to analyze this session'
		} finally {
			isAnalyzing = false
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

	<form onsubmit={handleAnalyze} aria-busy={isAnalyzing}>
		<label for="session-title">
			<span>Session title</span>
			<TextInput id="session-title" bind:value={title} required maxlength={200} />
		</label>
		<label for="session-transcript">
			<span>Raw transcript</span>
			<Textarea id="session-transcript" bind:value={transcript} required rows={18} />
		</label>
		<Button type="submit" disabled={isAnalyzing}>
			{isAnalyzing ? 'Analyzing…' : 'Analyze session'}
		</Button>
	</form>

	{#if analysisError}<p class="error" role="alert">{analysisError}</p>{/if}
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
		color: var(--gold);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}
	header {
		margin: 1.25rem 0 1.5rem;
	}
	header p:last-child {
		color: var(--ink-soft);
	}
	h2 {
		margin: 0.2rem 0 0.5rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3rem);
	}
	form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.4rem;
		font-weight: 700;
	}
	.error {
		color: #8b2f27;
	}
</style>
