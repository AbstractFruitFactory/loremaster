<script lang="ts">
	import logo from '#lib/assets/logo-eye.png'
	import type { PageProps } from './$types'

	let { form }: PageProps = $props()
</script>

<svelte:head>
	<title>Sign in | Loremaster</title>
	<meta name="description" content="Sign in to your Loremaster account." />
</svelte:head>

<main>
	<section class="auth-card" aria-labelledby="sign-in-heading">
		<img src={logo} alt="" />
		<p class="eyebrow">Return to the archive</p>
		<h1 id="sign-in-heading">Sign in</h1>

		<form method="POST">
			<label for="email">Email</label>
			<input
				name="email"
				id="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? ''}
			/>

			<label for="password">Password</label>
			<input
				name="password"
				id="password"
				type="password"
				autocomplete="current-password"
				required
			/>

			{#if form?.message}
				<p class="error" role="alert">{form.message}</p>
			{/if}

			<button>Continue</button>
		</form>

		<p class="alternate">New to Loremaster? <a href="/signup">Create an account</a></p>
	</section>
</main>

<style>
	main {
		display: grid;
		height: 100%;
		place-items: center;
		padding: 1.5rem;
		color: var(--color-text);
		font-family: var(--font-sans);
	}

	.auth-card {
		box-sizing: border-box;
		width: min(100%, 28rem);
		padding: clamp(2rem, 7vw, 3.25rem);
		border: 2px solid #25231f;
		border-radius: 3px;
		background: #fffaf0;
		box-shadow: 0.5rem 0.6rem 0 rgb(37 35 31 / 16%);
	}

	img {
		display: block;
		width: 5rem;
		margin: 0 auto 1rem;
	}

	.eyebrow,
	h1 {
		text-align: center;
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
		margin: 0.25rem 0 1.75rem;
		font-size: clamp(2.5rem, 8vw, 3.5rem);
	}

	form {
		display: grid;
		gap: 0.55rem;
	}

	label {
		margin-top: 0.45rem;
		font-weight: 700;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		padding: 0.75rem 0.85rem;
		border: 2px solid #25231f;
		border-radius: 2px;
		background: #fffdf7;
		color: inherit;
		font: inherit;
	}

	input:focus-visible,
	button:focus-visible,
	a:focus-visible {
		outline: 3px solid rgb(62 75 57 / 35%);
		outline-offset: 2px;
	}

	button {
		margin-top: 1rem;
		padding: 0.8rem 1rem;
		border: 2px solid #25231f;
		border-radius: 2px;
		background: var(--color-main);
		color: #fffaf0;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.error {
		margin: 0.5rem 0 0;
		color: #8a271f;
	}

	.alternate {
		margin: 1.5rem 0 0;
		text-align: center;
	}

	a {
		color: var(--color-main);
		font-weight: 700;
	}
</style>
