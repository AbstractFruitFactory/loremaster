<script lang="ts">
	import paperBackground from '#lib/assets/paper-background.png'
	import Button from '#lib/components/button/Button.svelte'
	import CampaignCard from '#lib/components/campaign-card/CampaignCard.svelte'
	import TextInput from '#lib/components/text-input/TextInput.svelte'
	import Textarea from '#lib/components/textarea/Textarea.svelte'
	import type { Campaign } from '#lib/server/campaign/types.js'

	type Props = {
		campaigns: readonly Campaign[] | undefined
		isLoading: boolean
		hasLoadError: boolean
		oncreate: (input: { name: string; description: string }) => Promise<void>
	}

	let { campaigns, isLoading, hasLoadError, oncreate }: Props = $props()

	let name = $state('')
	let description = $state('')
	let isCreating = $state(false)
	let createError = $state('')

	const getErrorMessage = (error: unknown) =>
		error instanceof Error ? error.message : 'Unable to create the campaign'

	const handleCreate = async (event: SubmitEvent) => {
		event.preventDefault()
		isCreating = true
		createError = ''

		try {
			await oncreate({ name, description })
			name = ''
			description = ''
		} catch (error) {
			createError = getErrorMessage(error)
		} finally {
			isCreating = false
		}
	}
</script>

<svelte:head>
	<title>Campaigns | Loremaster</title>
	<meta name="description" content="Create campaigns and grow their lore with Loremaster." />
</svelte:head>

<main class="page-shell" style:--paper-background={`url("${paperBackground}")`}>
	<div class="content">
		<header class="hero">
			<svg class="compass" viewBox="0 0 64 64" aria-hidden="true">
				<circle cx="32" cy="32" r="19"></circle>
				<path d="M32 5v54M5 32h54M13 13l38 38M51 13 13 51"></path>
				<path class="needle" d="m38 26-6 20-6-14 6-20 6 14Z"></path>
			</svg>
			<h1>Choose Your Campaign</h1>
			<p>Begin a new chronicle or continue an existing story.</p>
		</header>

		<section class="create-panel" aria-labelledby="new-campaign-heading">
			<div class="section-intro">
				<p class="eyebrow">A new chronicle</p>
				<h2 id="new-campaign-heading">Create New Campaign</h2>
				<p>Give your campaign a name and a short description to begin.</p>
			</div>

			<form onsubmit={handleCreate} aria-busy={isCreating}>
				<div class="fields">
					<label for="campaign-name">
						<span>Campaign name</span>
						<TextInput
							id="campaign-name"
							bind:value={name}
							required
							maxlength={200}
							autocomplete="off"
							--text-input-padding="0.75rem 0.85rem"
							--text-input-border="1px solid rgb(133 102 61 / 55%)"
							--text-input-radius="2px"
							--text-input-background="rgb(255 251 241 / 72%)"
							--text-input-color="var(--ink)"
							--text-input-focus-border="var(--gold)"
							--text-input-focus-ring="0 0 0 2px rgb(154 120 67 / 24%), 0 0 0 5px rgb(154 120 67 / 10%)"
						/>
					</label>

					<label for="campaign-description">
						<span>Description</span>
						<Textarea
							id="campaign-description"
							bind:value={description}
							required
							rows={2}
							--textarea-min-height="4.5rem"
							--textarea-padding="0.75rem 0.85rem"
							--textarea-border="1px solid rgb(133 102 61 / 55%)"
							--textarea-radius="2px"
							--textarea-background="rgb(255 251 241 / 72%)"
							--textarea-color="var(--ink)"
							--textarea-focus-border="var(--gold)"
							--textarea-focus-ring="0 0 0 2px rgb(154 120 67 / 24%), 0 0 0 5px rgb(154 120 67 / 10%)"
						/>
					</label>
				</div>

				<div class="form-action">
					<Button type="submit" disabled={isCreating}>
						{isCreating ? 'Creating…' : 'Create campaign'}
					</Button>
				</div>
			</form>

			{#if createError}
				<p class="error create-error" role="alert">{createError}</p>
			{/if}
		</section>

		<section class="campaign-section" aria-labelledby="campaign-list-heading">
			<div class="list-heading">
				<p class="eyebrow">Continue the tale</p>
				<h2 id="campaign-list-heading">Your Campaigns</h2>
			</div>

			{#if hasLoadError}
				<div class="state-panel error" role="alert">Unable to load campaigns.</div>
			{:else if isLoading}
				<div class="state-panel" role="status" aria-live="polite">Loading campaigns…</div>
			{:else if campaigns?.length}
				<ul class="campaign-grid">
					{#each campaigns as campaign (campaign.id)}
						<li>
							<CampaignCard
								name={campaign.name}
								description={campaign.description}
								href="/campaigns/{campaign.id}"
							/>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="state-panel">
					<strong>No campaigns yet.</strong>
					<span>Create your first campaign above to begin.</span>
				</div>
			{/if}
		</section>
	</div>
</main>

<style>
	.page-shell {
		--paper: #eee0c6;
		--paper-light: #f8eedb;
		--paper-panel: rgb(250 241 222 / 72%);
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		--gold-light: #c8aa75;
		box-sizing: border-box;
		min-height: 100dvh;
		padding: clamp(2.75rem, 4vw, 4rem) clamp(2rem, 7vw, 6rem);
		background-color: var(--paper);
		background-image: var(--paper-background);
		background-repeat: no-repeat;
		background-position: center;
		background-size: 100% 100%;
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.content {
		width: min(68rem, 100%);
		margin: 0 auto;
	}

	.hero {
		max-width: 42rem;
		margin: 0 auto clamp(1.75rem, 3vw, 2.5rem);
		text-align: center;
	}

	.compass {
		width: 2.75rem;
		margin-bottom: 0.5rem;
		overflow: visible;
		fill: none;
		stroke: var(--gold);
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1;
	}

	.compass .needle {
		fill: rgb(154 120 67 / 13%);
		stroke-width: 1.4;
	}

	.hero p {
		margin-bottom: 0;
		color: var(--ink-soft);
		font-family: var(--font-display);
		font-size: clamp(1.05rem, 2vw, 1.25rem);
	}

	.create-panel {
		position: relative;
		padding: clamp(1.25rem, 2.5vw, 1.75rem);
		border: 1px solid var(--gold-light);
		background: linear-gradient(rgb(255 250 237 / 54%), rgb(238 220 186 / 18%)), var(--paper-panel);
		box-shadow:
			0 1rem 2.5rem rgb(77 53 25 / 8%),
			inset 0 0 0 4px rgb(154 120 67 / 6%);
	}

	.create-panel::before,
	.create-panel::after {
		position: absolute;
		width: 1rem;
		height: 1rem;
		border-color: var(--gold);
		content: '';
		pointer-events: none;
	}

	.create-panel::before {
		top: 0.45rem;
		left: 0.45rem;
		border-top: 1px solid;
		border-left: 1px solid;
	}

	.create-panel::after {
		right: 0.45rem;
		bottom: 0.45rem;
		border-right: 1px solid;
		border-bottom: 1px solid;
	}

	.section-intro {
		margin-bottom: 1rem;
	}

	.section-intro h2,
	.list-heading h2 {
		margin-bottom: 0.3rem;
		font-size: clamp(1.7rem, 4vw, 2.25rem);
	}

	.section-intro > p:last-child {
		max-width: 37rem;
		margin-bottom: 0;
		color: var(--ink-soft);
		line-height: 1.55;
	}

	.eyebrow {
		margin-bottom: 0.25rem;
		color: var(--gold);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	form,
	.fields {
		display: grid;
		gap: 0.875rem;
	}

	form {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
	}

	.fields {
		grid-template-columns: minmax(12rem, 0.75fr) minmax(18rem, 1.25fr);
		align-items: start;
	}

	label {
		display: grid;
		gap: 0.4rem;
		color: var(--ink-soft);
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.form-action {
		display: flex;
		justify-content: flex-end;
		--color-main: #384b36;
		--color-surface: #fff8e8;
		--border-radius-md: 2px;
	}

	.campaign-section {
		margin-top: clamp(2rem, 4vw, 3rem);
	}

	.list-heading {
		position: relative;
		margin-bottom: 0.9rem;
		padding-bottom: 0.6rem;
		border-bottom: 1px solid rgb(154 120 67 / 38%);
	}

	.list-heading::after {
		position: absolute;
		bottom: -3px;
		left: 2.5rem;
		width: 5px;
		height: 5px;
		border: 1px solid var(--gold);
		background: var(--paper-light);
		content: '';
		transform: rotate(45deg);
	}

	.list-heading h2 {
		margin-bottom: 0;
	}

	.campaign-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.campaign-grid li {
		display: flex;
	}

	.state-panel {
		display: grid;
		gap: 0.3rem;
		padding: 1.6rem;
		border: 1px dashed rgb(154 120 67 / 48%);
		background: rgb(250 240 219 / 42%);
		color: var(--ink-soft);
		text-align: center;
	}

	.state-panel strong {
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 600;
	}

	.error {
		color: #8b2f27;
	}

	.create-error {
		margin: 1rem 0 0;
		font-weight: 650;
	}

	@media (max-width: 44rem) {
		.page-shell {
			padding: 3.5rem 1.75rem;
		}

		form {
			grid-template-columns: 1fr;
		}

		.fields {
			grid-template-columns: 1fr;
		}

		.form-action {
			justify-content: stretch;
		}

		.form-action :global(button) {
			width: 100%;
		}
	}

	@media (max-width: 28rem) {
		.page-shell {
			padding: 3rem 1.25rem;
		}

		.create-panel {
			padding: 1.35rem;
		}
	}
</style>
