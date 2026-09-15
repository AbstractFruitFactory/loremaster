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
		--stage-background: #2f3a34;

		box-sizing: border-box;
		display: grid;
		min-height: 100dvh;
		place-items: center;
		background: var(--stage-background);
	}

	.app-frame {
		box-sizing: border-box;
		width: 100%;
		height: 100dvh;
		overflow: hidden;
		background: var(--color-background);
	}
</style>
