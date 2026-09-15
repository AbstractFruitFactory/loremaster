<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLButtonAttributes } from 'svelte/elements'

	type ButtonVariant = 'primary' | 'secondary' | 'danger'
	type ButtonProps = Omit<HTMLButtonAttributes, 'class' | 'children'> & {
		variant?: ButtonVariant
		icon?: Snippet
		children: Snippet
	}

	let { variant = 'primary', icon, children, ...rest }: ButtonProps = $props()
</script>

<span class={['button-shell', variant]}>
	<span class="shadow" aria-hidden="true"></span>
	<button {...rest} class={['button', icon && 'has-icon']}>
		{#if icon}
			<span class="icon" aria-hidden="true">{@render icon()}</span>
		{/if}
		<span class="label">{@render children()}</span>
	</button>
</span>

<style>
	.button-shell {
		--button-background: var(--color-main);
		--button-border: var(--color-text);
		--button-color: var(--color-surface);
		--button-icon-background: #d77d57;
		--button-shadow: var(--color-text);
		--button-shadow-offset: 0.25rem;

		position: relative;
		display: inline-flex;
		padding-right: var(--button-shadow-offset);
		padding-bottom: var(--button-shadow-offset);
		vertical-align: middle;
	}

	.shadow {
		position: absolute;
		top: var(--button-shadow-offset);
		right: 0;
		bottom: 0;
		left: var(--button-shadow-offset);
		border-radius: 2px;
		background: var(--button-shadow);
	}

	.button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		border: 2px solid var(--button-border);
		border-radius: 2px;
		background: var(--button-background);
		color: var(--button-color);
		font: inherit;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			filter 80ms ease,
			transform 80ms ease,
			opacity 150ms ease;
	}

	.button.has-icon {
		gap: var(--spacing-md);
		padding-block: 0;
		padding-left: 0;
	}

	.button:hover:not(:disabled) {
		filter: brightness(1.06);
	}

	.button:active:not(:disabled) {
		filter: brightness(0.96);
		transform: translate(var(--button-shadow-offset), var(--button-shadow-offset));
	}

	.button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.button-shell.secondary {
		--button-background: var(--color-surface);
		--button-border: #34422f;
		--button-color: #34422f;
		--button-icon-background: #dfaa52;
		--button-shadow: #34422f;
	}

	.button-shell.danger {
		--button-background: #9b2f2f;
		--button-icon-background: #d77d57;
		--button-shadow: #571d1d;
	}

	.icon {
		display: inline-flex;
		align-self: stretch;
		align-items: center;
		justify-content: center;
		min-width: 2.75rem;
		padding: var(--spacing-sm);
		border-right: 2px solid var(--button-border);
		background: var(--button-icon-background);
		color: var(--button-border);
	}

	.label {
		display: inline-flex;
		align-items: center;
	}

	@media (prefers-reduced-motion: reduce) {
		.button {
			transition: none;
		}
	}
</style>
