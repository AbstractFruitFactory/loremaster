<script lang="ts">
	import '../global.scss'
	import favicon from '#lib/assets/favicon.svg'

	let { children } = $props()
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-stage">
	<div class="app-frame">
		{@render children()}
	</div>
</div>

<style>
	.app-stage {
		--stage-padding: clamp(0.75rem, 2.5vw, 1.75rem);
		--stage-background: #2f3a34;
		--frame-max-width: 90rem;
		--frame-max-height: 58rem;

		box-sizing: border-box;
		display: grid;
		min-height: 100dvh;
		place-items: center;
		padding: var(--stage-padding);
		background: var(--stage-background);
	}

	.app-frame {
		box-sizing: border-box;
		width: min(100%, var(--frame-max-width));
		height: min(calc(100dvh - (2 * var(--stage-padding))), var(--frame-max-height));
		overflow: hidden;
		background: var(--color-background);
	}

	@media (max-width: 52rem) {
		.app-stage {
			padding: 0;
		}

		.app-frame {
			width: 100%;
			height: 100dvh;
		}
	}
</style>
