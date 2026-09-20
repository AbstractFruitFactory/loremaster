<script lang="ts">
	import '../global.scss'
	import stageBackground from '#lib/assets/background.png'
	import favicon from '#lib/assets/favicon.svg'
	import type { LayoutProps } from './$types'

	let { data, children }: LayoutProps = $props()
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-stage" style:--stage-background={`url("${stageBackground}")`}>
	<div class="app-frame">
		{#if data.user}
			<div class="account">
				<span>{data.user.email}</span>
				<form method="POST" action="/logout">
					<button>Sign out</button>
				</form>
			</div>
		{/if}
		{@render children()}
	</div>
</div>

<style>
	.app-stage {
		--stage-padding: clamp(0.75rem, 2.5vw, 1.75rem);
		--frame-max-width: 90rem;

		box-sizing: border-box;
		display: grid;
		min-height: 100dvh;
		justify-items: center;
		padding: var(--stage-padding) var(--stage-padding) 0;
		background-color: #f4efe6;
		background-image: var(--stage-background);
		background-repeat: repeat;
		background-position: center top;
	}

	.app-frame {
		position: relative;
		box-sizing: border-box;
		width: min(100%, var(--frame-max-width));
		height: calc(100dvh - var(--stage-padding));
		overflow: hidden;
		background: transparent;
	}

	.account {
		position: absolute;
		z-index: 20;
		top: 0.45rem;
		right: 0.6rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.4rem 0.35rem 0.7rem;
		border: 1px solid rgb(37 35 31 / 28%);
		border-radius: 999px;
		background: rgb(255 250 240 / 92%);
		box-shadow: 0 2px 8px rgb(37 35 31 / 12%);
		color: var(--color-text);
		font-family: var(--font-sans);
		font-size: 0.78rem;
	}

	.account form {
		display: contents;
	}

	.account button {
		padding: 0.3rem 0.6rem;
		border: 0;
		border-radius: 999px;
		background: var(--color-main);
		color: #fffaf0;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.account button:focus-visible {
		outline: 3px solid rgb(62 75 57 / 35%);
		outline-offset: 2px;
	}

	@media (max-width: 52rem) {
		.account span {
			display: none;
		}
		.app-stage {
			padding: 0;
		}

		.app-frame {
			width: 100%;
			height: 100dvh;
		}
	}
</style>
