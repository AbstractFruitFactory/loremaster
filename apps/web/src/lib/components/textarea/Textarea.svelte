<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements'

	let {
		value = $bindable(''),
		...rest
	}: Omit<HTMLTextareaAttributes, 'class' | 'value'> & {
		value?: string
	} = $props()
</script>

<textarea {...rest} bind:value class="textarea"></textarea>

<style>
	.textarea {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--textarea-min-height, 4.5rem);
		max-height: var(--textarea-max-height, none);
		padding: var(--textarea-padding, 0.65rem 0.75rem);
		resize: none;
		border: var(--textarea-border, 1px solid rgb(145 111 65 / 58%));
		border-radius: var(--textarea-radius, 3px);
		outline: none;
		background: var(--textarea-background, rgb(255 251 241 / 78%));
		color: var(--textarea-color, #30291f);
		font: inherit;
		line-height: 1.45;
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease,
			background-color 150ms ease;
	}

	.textarea::placeholder {
		color: var(--textarea-placeholder-color, rgb(83 70 51 / 62%));
		opacity: 1;
	}

	.textarea:focus-visible {
		border-color: var(--textarea-focus-border, #9a7843);
		box-shadow: var(--textarea-focus-ring, 0 0 0 3px rgb(154 120 67 / 18%));
	}

	.textarea:disabled {
		background: var(--textarea-disabled-background, rgb(233 226 211 / 78%));
		cursor: not-allowed;
		opacity: 0.72;
	}
</style>
