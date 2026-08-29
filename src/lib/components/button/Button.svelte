<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements'

	type ButtonVariant = 'primary' | 'secondary' | 'danger'

	let {
		variant = 'primary',
		children,
		...rest
	}: Omit<HTMLButtonAttributes, 'class'> & {
		variant?: ButtonVariant
		type?: HTMLButtonAttributes['type']
	} = $props()
</script>

<button {...rest} class={['button', variant]}>
	{@render children?.()}
</button>

<style>
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--color-main);
		border-radius: var(--border-radius-md);
		background: var(--color-main);
		color: var(--color-surface);
		box-shadow: var(--shadow-sm);
		font: inherit;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			box-shadow 150ms ease,
			filter 150ms ease,
			transform 150ms ease,
			opacity 150ms ease;
	}

	.button:hover:not(:disabled) {
		box-shadow: var(--shadow-md);
		filter: brightness(1.08);
		transform: translateY(-1px);
	}

	.button:active:not(:disabled) {
		box-shadow: var(--shadow-sm);
		filter: brightness(0.94);
		transform: translateY(0);
	}

	.button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.secondary {
		border-color: #899483;
		background: var(--color-surface);
		color: #34422f;
	}

	.danger {
		background: #9b2f2f;
	}
</style>
