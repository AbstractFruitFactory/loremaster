<script lang="ts">
	import type { PageProps } from './$types'

	let { data, form }: PageProps = $props()
	let copied = $state(false)

	function formatDate(value: Date | string) {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value))
	}

	async function copyInvite() {
		if (!form?.inviteUrl) return
		await navigator.clipboard.writeText(form.inviteUrl)
		copied = true
	}
</script>

<svelte:head>
	<title>Invitations | Loremaster</title>
	<meta name="description" content="Invite people to Loremaster." />
</svelte:head>

<main>
	<div class="page-heading">
		<div>
			<p class="eyebrow">Administration</p>
			<h1>Invitations</h1>
		</div>
		<a class="back" href="/">Back to campaigns</a>
	</div>

	<section class="panel" aria-labelledby="new-invite-heading">
		<h2 id="new-invite-heading">Invite someone</h2>
		<p class="intro">Create a secure, single-use signup link. Invitations expire automatically.</p>

		<form method="POST">
			<label for="invite-email">Email address</label>
			<div class="form-row">
				<input
					id="invite-email"
					name="email"
					type="email"
					autocomplete="email"
					required
					value={form?.email ?? ''}
				/>
				<button type="submit">Create invitation</button>
			</div>
		</form>

		{#if form?.message}
			<p class:success={Boolean(form.inviteUrl)} class:error={!form.inviteUrl} role="status">
				{form.message}
			</p>
		{/if}

		{#if form?.inviteUrl}
			<div class="invite-result">
				<label for="invite-url">Invitation link</label>
				<div class="form-row">
					<input id="invite-url" readonly value={form.inviteUrl} />
					<button type="button" class="secondary" onclick={copyInvite}>
						{copied ? 'Copied' : 'Copy link'}
					</button>
				</div>
				{#if form.expiresAt}
					<p class="expiry">Expires {formatDate(form.expiresAt)}</p>
				{/if}
			</div>
		{/if}
	</section>

	<section class="panel" aria-labelledby="recent-invites-heading">
		<h2 id="recent-invites-heading">Recent invitations</h2>
		{#if data.invites.length === 0}
			<p class="empty">No invitations yet.</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Email</th>
							<th scope="col">Status</th>
							<th scope="col">Created</th>
							<th scope="col">Expires</th>
						</tr>
					</thead>
					<tbody>
						{#each data.invites as invite (invite.id)}
							{@const expired = !invite.acceptedAt && new Date(invite.expiresAt) <= new Date()}
							<tr>
								<td>{invite.email}</td>
								<td>
									<span class="status" class:accepted={Boolean(invite.acceptedAt)} class:expired>
										{invite.acceptedAt ? 'Accepted' : expired ? 'Expired' : 'Pending'}
									</span>
								</td>
								<td>{formatDate(invite.createdAt)}</td>
								<td>{formatDate(invite.expiresAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>

<style>
	main {
		box-sizing: border-box;
		height: 100%;
		overflow-y: auto;
		padding: clamp(4.5rem, 9vw, 7rem) clamp(1rem, 5vw, 4rem) 3rem;
		color: var(--color-text);
		font-family: var(--font-sans);
	}

	.page-heading {
		display: flex;
		width: min(100%, 62rem);
		margin: 0 auto 1.5rem;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0;
		color: var(--color-main);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0.15rem 0 0;
		font-size: clamp(2.5rem, 7vw, 4.5rem);
	}

	.back {
		color: var(--color-main);
		font-weight: 700;
	}

	.panel {
		box-sizing: border-box;
		width: min(100%, 62rem);
		margin: 0 auto 1.5rem;
		padding: clamp(1.25rem, 4vw, 2rem);
		border: 2px solid #25231f;
		border-radius: 3px;
		background: #fffaf0;
		box-shadow: 0.4rem 0.5rem 0 rgb(37 35 31 / 14%);
	}

	h2 {
		margin: 0;
		font-size: 1.6rem;
	}

	.intro,
	.empty {
		margin: 0.35rem 0 1.25rem;
		color: var(--color-muted);
	}

	form,
	.invite-result {
		display: grid;
		gap: 0.55rem;
	}

	.invite-result {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid rgb(37 35 31 / 25%);
	}

	label {
		font-weight: 700;
	}

	.form-row {
		display: flex;
		align-items: stretch;
		gap: 0.65rem;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: 0.75rem 0.85rem;
		border: 2px solid #25231f;
		border-radius: 2px;
		background: #fffdf7;
		color: inherit;
		font: inherit;
	}

	input:read-only {
		background: #eee9df;
	}

	button {
		flex: 0 0 auto;
		padding: 0.75rem 1rem;
		border: 2px solid #25231f;
		border-radius: 2px;
		background: var(--color-main);
		color: #fffaf0;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	button.secondary {
		background: #fffaf0;
		color: var(--color-main);
	}

	input:focus-visible,
	button:focus-visible,
	a:focus-visible {
		outline: 3px solid rgb(62 75 57 / 35%);
		outline-offset: 2px;
	}

	.success,
	.error,
	.expiry {
		margin: 0.75rem 0 0;
		font-size: 0.9rem;
	}

	.success {
		color: var(--color-main);
	}

	.error {
		color: #8a271f;
	}

	.expiry {
		margin: 0;
		color: var(--color-muted);
	}

	.table-wrap {
		overflow-x: auto;
		margin-top: 1rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}

	th,
	td {
		padding: 0.75rem;
		border-bottom: 1px solid rgb(37 35 31 / 20%);
		text-align: left;
		white-space: nowrap;
	}

	th {
		color: var(--color-muted);
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.status {
		display: inline-block;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: #e7dfc9;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.status.accepted {
		background: #dce8d8;
		color: #294524;
	}

	.status.expired {
		background: #ecd8d5;
		color: #75251f;
	}

	@media (max-width: 42rem) {
		.page-heading {
			align-items: start;
			flex-direction: column;
		}

		.form-row {
			align-items: stretch;
			flex-direction: column;
		}

		button {
			width: 100%;
		}
	}
</style>
