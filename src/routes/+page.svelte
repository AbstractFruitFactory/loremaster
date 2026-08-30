<script lang="ts">
	import Button from '#lib/components/button/Button.svelte'
	import { createCampaign, listCampaigns } from './data.remote'

	const campaigns = listCampaigns()

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
			await createCampaign({ name, description })
			await campaigns.refresh()
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

<main>
	<header>
		<p class="eyebrow">Loremaster</p>
		<h1>Campaigns</h1>
		<p>Create a campaign, then shape its people, places, and history with Loremaster.</p>
	</header>

	<section aria-labelledby="new-campaign-heading">
		<h2 id="new-campaign-heading">New campaign</h2>

		<form onsubmit={handleCreate} aria-busy={isCreating}>
			<label>
				Name
				<input bind:value={name} required maxlength="200" autocomplete="off" />
			</label>

			<label>
				Description
				<textarea bind:value={description} required rows="3"></textarea>
			</label>

			<Button type="submit" disabled={isCreating}>
				{isCreating ? 'Creating…' : 'Create campaign'}
			</Button>
		</form>

		{#if createError}
			<p class="error" role="alert">{createError}</p>
		{/if}
	</section>

	<section aria-labelledby="campaign-list-heading">
		<h2 id="campaign-list-heading">Your campaigns</h2>

		{#if campaigns.error}
			<p class="error" role="alert">Unable to load campaigns.</p>
		{:else if campaigns.loading && !campaigns.current}
			<p role="status">Loading campaigns…</p>
		{:else if campaigns.current?.length}
			<ul>
				{#each campaigns.current as campaign (campaign.id)}
					<li>
						<a href="/campaigns/{campaign.id}">
							<strong>{campaign.name}</strong>
							<span>{campaign.description}</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p>No campaigns yet.</p>
		{/if}
	</section>
</main>

<style>
	main {
		width: min(56rem, calc(100% - 2rem));
		margin: 0 auto;
		padding: 3rem 0;
	}

	header {
		margin-bottom: 2rem;
	}

	h1,
	h2,
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: 0.5rem;
		font-size: clamp(2rem, 6vw, 3.25rem);
	}

	h2 {
		font-size: 1.2rem;
	}

	.eyebrow {
		margin-bottom: 0.35rem;
		color: #6b6255;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	section {
		margin-top: 1rem;
		padding: 1.25rem;
		border: 1px solid #d8d2c8;
		border-radius: 0.75rem;
		background: #fff;
	}

	form {
		display: grid;
		gap: 1rem;
	}

	label {
		display: grid;
		gap: 0.4rem;
		font-weight: 650;
	}

	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		padding: 0.7rem 0.8rem;
		border: 1px solid #aaa298;
		border-radius: 0.4rem;
		color: inherit;
		font: inherit;
	}

	textarea {
		resize: vertical;
	}

	ul {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li a {
		display: grid;
		gap: 0.25rem;
		padding: 0.9rem;
		border: 1px solid #ded9d1;
		border-radius: 0.5rem;
		color: inherit;
		text-decoration: none;
	}

	li a:hover {
		border-color: #7a8873;
		background: #fafbf9;
	}

	li span {
		color: #625e57;
	}

	.error {
		margin-top: 1rem;
		margin-bottom: 0;
		color: #a12727;
	}
</style>
