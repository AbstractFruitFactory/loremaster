<script lang="ts">
	import logo from '#lib/assets/logo-eye.png'
	import Button from '#lib/components/button/Button.svelte'
	import CampaignCard from '#lib/components/campaign-card/CampaignCard.svelte'
	import TextInput from '#lib/components/text-input/TextInput.svelte'
	import Textarea from '#lib/components/textarea/Textarea.svelte'
	import Window from '#lib/components/window/Window.svelte'
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
	const isCreateDisabled = $derived(
		isCreating || name.trim().length === 0 || description.trim().length === 0
	)

	const getErrorMessage = (error: unknown) =>
		error instanceof Error ? error.message : 'Unable to create the campaign'

	const handleCreate = async (event: SubmitEvent) => {
		event.preventDefault()
		const campaignName = name.trim()
		const campaignDescription = description.trim()

		if (isCreating || !campaignName || !campaignDescription) return

		isCreating = true
		createError = ''

		try {
			await oncreate({ name: campaignName, description: campaignDescription })
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

<main class="page-shell">
	<div class="content">
		<header class="brand-hero">
			<img class="brand-logo" src={logo} alt="" />
			<h1>Loremaster</h1>
			<p class="page-heading">Choose your campaign</p>
			<p class="hero-copy">Begin a new chronicle or continue an existing story.</p>
		</header>

		<div class="window-grid">
			<div class="create-window">
				<Window title="Create New Campaign" eyebrow="Begin a new chronicle" size="fill">
					<p class="window-intro">
						Give your campaign a memorable name and a short description of the story ahead.
					</p>

					<form
						id="create-campaign-form"
						onsubmit={handleCreate}
						aria-busy={isCreating}
						aria-describedby={createError ? 'create-campaign-error' : undefined}
					>
						<div class="field">
							<label for="campaign-name">Campaign name</label>
							<p id="campaign-name-hint">The title shown throughout your campaign workspace.</p>
							<TextInput
								id="campaign-name"
								name="campaignName"
								bind:value={name}
								required
								maxlength={200}
								autocomplete="off"
								placeholder="The Ashen Crown"
								disabled={isCreating}
								aria-describedby="campaign-name-hint"
								--text-input-padding="0.75rem 0.85rem"
								--text-input-border="2px solid var(--ink)"
								--text-input-radius="2px"
								--text-input-background="#fffdf7"
								--text-input-color="var(--ink)"
								--text-input-focus-border="var(--green)"
								--text-input-focus-ring="0 0 0 3px rgb(56 75 54 / 18%)"
							/>
						</div>

						<div class="field">
							<label for="campaign-description">Description</label>
							<p id="campaign-description-hint">
								Summarize the setting, central conflict, or tone in a sentence or two.
							</p>
							<Textarea
								id="campaign-description"
								name="campaignDescription"
								bind:value={description}
								required
								rows={4}
								placeholder="Forgotten kingdoms, dangerous relics, and an ancient oath…"
								disabled={isCreating}
								aria-describedby="campaign-description-hint"
								--textarea-min-height="7rem"
								--textarea-padding="0.75rem 0.85rem"
								--textarea-border="2px solid var(--ink)"
								--textarea-radius="2px"
								--textarea-background="#fffdf7"
								--textarea-color="var(--ink)"
								--textarea-focus-border="var(--green)"
								--textarea-focus-ring="0 0 0 3px rgb(56 75 54 / 18%)"
							/>
						</div>

						<div class="form-actions">
							<div class="form-feedback">
								{#if createError}
									<p id="create-campaign-error" class="error" role="alert">{createError}</p>
								{:else}
									<p>Both fields are required.</p>
								{/if}
							</div>
							<Button type="submit" disabled={isCreateDisabled}>
								{isCreating ? 'Creating…' : 'Create campaign'}
							</Button>
						</div>
					</form>
				</Window>
			</div>

			<div class="campaign-window">
				<Window title="Your Campaigns" eyebrow="Continue the tale" size="fill">
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
							<span>Create your first campaign to begin.</span>
						</div>
					{/if}
				</Window>
			</div>
		</div>
	</div>
</main>

<style>
	.page-shell {
		--ink: var(--color-text, #25231f);
		--ink-soft: var(--color-muted, #625e57);
		--green: var(--color-main, #3e4b39);

		box-sizing: border-box;
		height: 100%;
		min-height: 100%;
		overflow-y: auto;
		padding: clamp(2rem, 4vw, 3.5rem) clamp(1rem, 4vw, 3.5rem) clamp(2.5rem, 5vw, 4rem);
		background: transparent;
		color: var(--ink);
		font-family: var(--font-sans);
	}

	.content {
		width: min(74rem, 100%);
		margin: 0 auto;
	}

	.brand-hero {
		display: grid;
		justify-items: center;
		max-width: 42rem;
		margin: 0 auto clamp(2rem, 4vw, 3.25rem);
		text-align: center;
	}

	.brand-logo {
		width: clamp(6.5rem, 12vw, 9rem);
		margin-bottom: 0.75rem;
		filter: drop-shadow(0.25rem 0.35rem 0 rgb(255 250 240 / 72%));
	}

	h1 {
		margin-bottom: 0.3rem;
		color: #090909;
		font-size: clamp(3.4rem, 8vw, 5.75rem);
		line-height: 0.85;
	}

	.page-heading {
		margin-bottom: 0.45rem;
		color: var(--green);
		font-family: var(--font-display);
		font-size: clamp(1.35rem, 3vw, 1.85rem);
		font-weight: 600;
		letter-spacing: 0.025em;
	}

	.hero-copy {
		margin: 0;
		color: var(--ink-soft);
		font-size: clamp(0.98rem, 2vw, 1.1rem);
	}

	.window-grid {
		display: grid;
		grid-template-columns: minmax(19rem, 0.78fr) minmax(0, 1.45fr);
		gap: clamp(1.25rem, 3vw, 2rem);
		align-items: stretch;
	}

	.create-window,
	.campaign-window {
		min-width: 0;
		padding: 0 0.35rem 0.35rem 0;
	}

	.window-intro {
		margin-bottom: 1.25rem;
		color: var(--ink-soft);
		line-height: 1.55;
	}

	form,
	.field {
		display: grid;
	}

	form {
		gap: 1.2rem;
	}

	.field {
		gap: 0.35rem;
	}

	label {
		font-weight: 700;
		letter-spacing: 0.015em;
	}

	.field p {
		margin: -0.1rem 0 0.2rem;
		color: var(--ink-soft);
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.form-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.15rem;
		padding-top: 1rem;
		border-top: 1px solid rgb(37 35 31 / 22%);
		--color-main: #384b36;
		--color-surface: #fffaf0;
	}

	.form-feedback {
		min-width: 0;
		color: var(--ink-soft);
		font-size: 0.8rem;
	}

	.form-feedback p {
		margin: 0;
	}

	.error {
		color: #8b2f27;
		font-weight: 650;
	}

	.campaign-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.campaign-grid li {
		display: flex;
		min-width: 0;
		padding: 0 0.25rem 0.25rem 0;
	}

	.state-panel {
		display: grid;
		flex: 1;
		gap: 0.3rem;
		min-height: 10rem;
		padding: 1.6rem;
		place-content: center;
		border: 2px dashed rgb(37 35 31 / 38%);
		background: #f7f1e6;
		color: var(--ink-soft);
		text-align: center;
	}

	.state-panel strong {
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 600;
	}

	@media (max-width: 62rem) {
		.window-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 36rem) {
		.page-shell {
			padding: 1.5rem 0.85rem 2.5rem;
		}

		.brand-hero {
			margin-bottom: 1.75rem;
		}

		.form-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
