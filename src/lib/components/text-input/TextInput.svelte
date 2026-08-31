<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements'

	let {
		value = $bindable(''),
		...rest
	}: Omit<HTMLInputAttributes, 'class' | 'value'> & {
		value?: string
	} = $props()
</script>

<input {...rest} type="text" bind:value class="text-input" />

<style>
	.text-input {
		box-sizing: border-box;
		width: 100%;
		padding: var(--text-input-padding, 0.65rem 0.75rem);
		border: var(--text-input-border, 1px solid rgb(145 111 65 / 58%));
		border-radius: var(--text-input-radius, 3px);
		outline: none;
		background: var(--text-input-background, rgb(255 251 241 / 78%));
		color: var(--text-input-color, #30291f);
		font: inherit;
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease,
			background-color 150ms ease;
	}

	.text-input::placeholder {
		color: var(--text-input-placeholder-color, rgb(83 70 51 / 62%));
		opacity: 1;
	}

	.text-input:focus-visible {
		border-color: var(--text-input-focus-border, #9a7843);
		box-shadow: var(--text-input-focus-ring, 0 0 0 3px rgb(154 120 67 / 18%));
	}

	.text-input:disabled {
		background: var(--text-input-disabled-background, rgb(233 226 211 / 78%));
		cursor: not-allowed;
		opacity: 0.72;
	}
</style>
