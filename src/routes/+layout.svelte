<script lang="ts">
	import '../global.scss'
	import stageBackground from '#lib/assets/background.png'
	import favicon from '#lib/assets/favicon.svg'

	let { children } = $props()
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-stage" style:--stage-background={`url("${stageBackground}")`}>
	<div class="app-frame">
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
		box-sizing: border-box;
		width: min(100%, var(--frame-max-width));
		height: calc(100dvh - var(--stage-padding));
		overflow: hidden;
		background: transparent;
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
