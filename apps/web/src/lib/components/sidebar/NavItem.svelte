<script lang="ts">
	import Icon from '@iconify/svelte'

	let {
		label,
		href,
		icon,
		iconSrc,
		active = false,
		variant = 'sidebar'
	}: {
		label: string
		href?: string
		icon: string
		iconSrc?: string
		active?: boolean
		variant?: 'sidebar' | 'tab'
	} = $props()
</script>

{#snippet content()}
	<span class="icon" aria-hidden="true">
		{#if iconSrc}
			<img src={iconSrc} alt="" />
		{:else}
			<Icon {icon} width="1.15rem" height="1.15rem" color="currentColor" aria-hidden="true" />
		{/if}
	</span>
	<span class="label">{label}</span>
{/snippet}

{#if href !== undefined}
	<a class={['nav-item', variant, { active }]} {href} aria-current={active ? 'page' : undefined}>
		{@render content()}
	</a>
{:else}
	<span class={['nav-item', variant, 'inert']} aria-disabled="true">
		{@render content()}
	</span>
{/if}

<style>
	.nav-item {
		position: relative;
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.7rem;
		padding: 0.65rem 0.85rem 0.65rem 1rem;
		border: 1px solid transparent;
		border-radius: 0.2rem;
		color: #f2e7cf;
		font-family: var(--font-sans);
		font-size: 0.95rem;
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: 0.015em;
		text-decoration: none;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			color 150ms ease,
			box-shadow 150ms ease;
	}

	.nav-item::before {
		position: absolute;
		inset: 0.35rem auto 0.35rem -0.1rem;
		width: 0.15rem;
		border-radius: 999px;
		background: transparent;
		content: '';
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}

	a.nav-item:hover {
		border-color: rgb(205 164 92 / 18%);
		background: rgb(244 228 197 / 7%);
		color: #fff5df;
	}

	a.nav-item.active {
		border-color: rgb(205 164 92 / 24%);
		background: linear-gradient(90deg, rgb(187 132 54 / 24%), rgb(236 213 169 / 10%));
		box-shadow: inset 0 0 1.25rem rgb(240 199 116 / 4%);
		color: #fff4dc;
	}

	a.nav-item.active::before {
		background: #cda45c;
		box-shadow: 0 0 0.55rem rgb(205 164 92 / 45%);
	}

	a.nav-item:focus-visible {
		border-color: #e1bd77;
		outline: 2px solid #efd290;
		outline-offset: 3px;
		background: rgb(205 164 92 / 16%);
		box-shadow: 0 0 0 4px rgb(11 18 22 / 80%);
	}

	.nav-item.inert {
		color: #b9ad96;
		cursor: default;
	}

	.nav-item.inert .icon {
		color: #8f8168;
	}

	.icon {
		display: inline-flex;
		width: 1.5rem;
		height: 1.5rem;
		flex: 0 0 1.5rem;
		align-items: center;
		justify-content: center;
		color: #cda45c;
		line-height: 1;
	}

	.icon img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.label {
		min-width: 0;
	}

	.nav-item.tab {
		height: 42px;
		flex: 0 0 auto;
		gap: 8px;
		padding: 5px 13px 5px 6px;
		border: 1px solid rgb(113 77 49 / 18%);
		border-radius: 8px;
		background: rgb(255 250 239 / 45%);
		color: #705c4c;
		font-size: 0.82rem;
	}

	.nav-item.tab::before {
		display: none;
	}

	a.nav-item.tab:hover {
		border-color: rgb(113 77 49 / 35%);
		background: rgb(255 250 239 / 75%);
		color: #422c24;
	}

	a.nav-item.tab.active {
		border-color: #c98b3d;
		background: #fff8e9;
		box-shadow: 0 2px 5px rgb(73 45 28 / 10%);
		color: #37241d;
	}

	.nav-item.tab .icon {
		display: grid;
		aspect-ratio: 1;
		width: 32px;
		height: 32px;
		flex: 0 0 32px;
		place-items: center;
		background: transparent;
		color: #cba45e;
	}

	.nav-item.tab .icon img {
		display: block;
		flex: 0 0 28px;
		width: 28px;
		height: 28px;
		aspect-ratio: 1;
		object-fit: contain;
	}

	a.nav-item.tab.active .icon {
		background: transparent;
		color: #7b5d2d;
	}
</style>
