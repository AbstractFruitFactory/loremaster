<script lang="ts">
	import Icon from '@iconify/svelte'

	let {
		label,
		href,
		icon,
		active = false
	}: {
		label: string
		href?: string
		icon: string
		active?: boolean
	} = $props()
</script>

{#snippet content()}
	<span class="icon" aria-hidden="true">
		<Icon {icon} width="1.15rem" height="1.15rem" color="currentColor" aria-hidden="true" />
	</span>
	<span class="label">{label}</span>
{/snippet}

{#if href !== undefined}
	<a class={['nav-item', { active }]} {href} aria-current={active ? 'page' : undefined}>
		{@render content()}
	</a>
{:else}
	<span class="nav-item inert" aria-disabled="true">
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
		width: 1.15rem;
		height: 1.15rem;
		flex: 0 0 1.15rem;
		align-items: center;
		justify-content: center;
		color: #cda45c;
		line-height: 1;
	}

	.label {
		min-width: 0;
	}
</style>
