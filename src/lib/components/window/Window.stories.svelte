<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Icon from '@iconify/svelte'
	import type { ComponentProps } from 'svelte'

	import logo from '#lib/assets/logo-eye.png'
	import Window from './Window.svelte'

	type WindowArgs = ComponentProps<typeof Window>

	const defaultArgs = {
		title: 'The Ashen Crown',
		eyebrow: 'Campaign overview'
	} satisfies Partial<WindowArgs>

	const compactArgs = {
		title: 'Quick notes',
		class: 'compact-window'
	} satisfies Partial<WindowArgs>

	const { Story } = defineMeta({
		title: 'Components/Window',
		component: Window,
		tags: ['autodocs']
	})
</script>

{#snippet logoIcon()}
	<img src={logo} alt="" />
{/snippet}

{#snippet windowActions()}
	<button class="icon-button" type="button" aria-label="Close window">
		<Icon icon="lucide:x" width="1rem" height="1rem" />
	</button>
{/snippet}

{#snippet footer()}
	<span class="footer-copy"><span aria-hidden="true">△</span> Last updated after session 12</span>
{/snippet}

<Story name="Loremaster" args={{ ...defaultArgs, icon: logoIcon, actions: windowActions, footer }}>
	<div class="body-copy">
		<p>
			The crown has resurfaced in Greyhaven. Three factions now search for it, though none know that
			the relic answers only to a forgotten name.
		</p>
		<div class="facts">
			<span><strong>7</strong> characters</span>
			<span><strong>4</strong> open threads</span>
			<span><strong>12</strong> sessions</span>
		</div>
	</div>
</Story>

<Story name="Compact" args={{ ...compactArgs, actions: windowActions }}>
	<div class="compact-story">
		<p>The western gate is watched after dusk.</p>
		<p>Mara still has the silver key.</p>
	</div>
</Story>

<style>
	:global(.sb-show-main.sb-main-padded) {
		background: #e8e2d8;
	}

	.body-copy,
	.compact-story {
		font-size: 0.92rem;
		line-height: 1.55;
	}

	p {
		margin: 0;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin-top: 1rem;
	}

	.facts span {
		padding: 0.28rem 0.55rem;
		border: 1px solid rgb(37 35 31 / 42%);
		background: #f1eadc;
		font-size: 0.78rem;
	}

	.icon-button {
		display: grid;
		width: 1.9rem;
		height: 1.9rem;
		padding: 0;
		place-items: center;
		border: 1.5px solid #25231f;
		border-radius: 1px;
		background: #fffaf0;
		cursor: pointer;
	}

	.icon-button:hover {
		background: #ff736b;
	}

	.footer-copy {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: #625e57;
		font-size: 0.76rem;
	}

	.compact-story {
		font-size: 0.86rem;
	}

	:global(.compact-window) {
		width: min(100%, 22rem);
	}

	.compact-story p + p {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid rgb(37 35 31 / 18%);
	}
</style>
