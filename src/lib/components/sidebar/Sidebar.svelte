<script lang="ts">
	import sidebarBackground from '../../assets/sidebar-background.png'
	import NavItem from './NavItem.svelte'

	let {
		items,
		activePath = '/campaigns'
	}: {
		items: readonly { label: string; href?: string; icon: string }[]
		activePath?: string
	} = $props()
</script>

<aside
	class="sidebar"
	style:--sidebar-background={`url("${sidebarBackground}")`}
	aria-label="Primary navigation"
>
	<a class="brand" href="/" aria-label="Loremaster home">
		<svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
			<circle cx="20" cy="20" r="8" />
			<circle cx="20" cy="20" r="2.25" />
			<path d="M20 3v10m0 14v10M3 20h10m14 0h10" />
			<path d="m20 7 3 10 10 3-10 3-3 10-3-10-10-3 10-3z" />
		</svg>
		<span>LOREMASTER</span>
	</a>

	<nav aria-label="Main">
		<ul>
			{#each items as item (item.label)}
				<li>
					<NavItem {...item} active={item.href !== undefined && activePath === item.href} />
				</li>
			{/each}
		</ul>
	</nav>
</aside>

<style>
	.sidebar {
		box-sizing: border-box;
		width: var(--sidebar-width, 17.5rem);
		min-height: var(--sidebar-min-height, 100dvh);
		padding: 1.75rem 1.45rem 1.55rem;
		background-color: #10171c;
		background-image:
			linear-gradient(rgb(8 14 18 / 8%), rgb(8 14 18 / 18%)), var(--sidebar-background);
		background-position: center;
		background-size:
			100% 100%,
			100% 100%;
		color: #f2e7cf;
		font-family: var(--font-sans);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.7rem;
		margin: 0 0 2.25rem 0.35rem;
		border-radius: 0.2rem;
		color: #cda45c;
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		line-height: 1;
		text-decoration: none;
	}

	.brand:hover {
		color: #e0bd78;
	}

	.brand:focus-visible {
		outline: 2px solid #e0bd78;
		outline-offset: 0.35rem;
	}

	.brand-mark {
		width: 2.2rem;
		height: 2.2rem;
		flex: 0 0 2.2rem;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1;
	}

	nav,
	ul {
		margin: 0;
		padding: 0;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		list-style: none;
	}
</style>
