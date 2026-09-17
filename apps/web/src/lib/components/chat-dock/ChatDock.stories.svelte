<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import type { ComponentProps } from 'svelte'
	import ChatDock from './ChatDock.svelte'

	type ChatDockArgs = ComponentProps<typeof ChatDock>

	const onask: ChatDockArgs['onask'] = async function* ({ message }) {
		yield {
			type: 'sources',
			sources: [{ id: 'source-1', title: 'The Oath of Emberwatch', type: 'worldbuilding' }]
		}
		yield {
			type: 'text-delta',
			delta: `The Ashen Crown is bound to the oath spoken at Emberwatch. “${message}” connects to the missing final verse.`
		}
		yield { type: 'done' }
	}

	const onaddlore: ChatDockArgs['onaddlore'] = async ({ title }) => ({ title })

	const defaultArgs = {
		campaignId: '17ea64a7-98e4-40de-ae5f-b8e35688e157',
		mode: 'sidebar',
		conversationHistory: [],
		onask,
		onaddlore
	} satisfies ChatDockArgs

	const { Story } = defineMeta({
		title: 'Components/ChatDock',
		component: ChatDock,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	})
</script>

{#snippet stage(args: ChatDockArgs)}
	<div class="stage">
		<main class="campaign-preview">
			<header>
				<p class="eyebrow">Campaign workspace</p>
				<h1>The Ashen Crown</h1>
				<p>Track the people, places, and discoveries shaping Emberwatch.</p>
			</header>

			<section aria-label="Recent campaign lore">
				<article>
					<h2>The Oath of Emberwatch</h2>
					<p>The final verse remains missing from the city archive.</p>
				</article>
				<article>
					<h2>Warden Elara Voss</h2>
					<p>Last seen carrying the crown toward the northern gate.</p>
				</article>
			</section>
		</main>
		<ChatDock {...args} />
	</div>
{/snippet}

<Story name="Sidebar" args={defaultArgs} template={stage} />
<Story name="Expanded" args={{ ...defaultArgs, mode: 'expanded' }} template={stage} />
<Story name="Hidden" args={{ ...defaultArgs, mode: 'hidden' }} template={stage} />

<style>
	.stage {
		--workspace-gap: 1rem;
		--chat-panel-width: 28rem;

		position: relative;
		height: 46rem;
		padding: var(--workspace-gap);
		overflow: hidden;
		background: #2b3732;
	}

	.campaign-preview {
		box-sizing: border-box;
		height: 100%;
		padding: clamp(2rem, 5vw, 4rem);
		background: #f4ead8;
		color: #302b24;
	}

	header {
		max-width: 38rem;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: #896a37;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-family: var(--font-display);
		font-size: clamp(2.2rem, 6vw, 4rem);
		line-height: 1;
	}

	header > p:last-child {
		margin: 0;
		color: #62594b;
		line-height: 1.5;
	}

	section {
		display: grid;
		max-width: 44rem;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: 1rem;
		margin-top: 2.5rem;
	}

	article {
		padding: 1rem;
		border: 1px solid #645946;
		background: #fffaf0;
		box-shadow: 0.2rem 0.2rem 0 #645946;
	}

	h2 {
		margin: 0 0 0.4rem;
		font-family: var(--font-display);
		font-size: 1.25rem;
	}

	article p {
		margin: 0;
		color: #62594b;
		line-height: 1.45;
	}
</style>
