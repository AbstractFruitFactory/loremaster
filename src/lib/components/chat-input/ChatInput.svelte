<script lang="ts">
	import Icon from '@iconify/svelte'
	import { tick } from 'svelte'
	import Textarea from '#lib/components/textarea/Textarea.svelte'

	type Props = {
		value?: string
		onsubmit: () => void | Promise<void>
		isSubmitting?: boolean
		disabled?: boolean
		placeholder?: string
		maxlength?: number
		label?: string
		id?: string
	}

	let {
		value = $bindable(''),
		onsubmit,
		isSubmitting = false,
		disabled = false,
		placeholder = 'Ask Loremaster anything…',
		maxlength = 2000,
		label = 'Ask a question or shape your lore',
		id = 'chat-input-message'
	}: Props = $props()

	let isHandlingSubmit = $state(false)

	const handleSubmit = async (event: SubmitEvent) => {
		event.preventDefault()
		if (disabled || isSubmitting || isHandlingSubmit || !value.trim()) return

		const form = event.currentTarget as HTMLFormElement
		isHandlingSubmit = true
		try {
			await onsubmit()
		} finally {
			isHandlingSubmit = false
			await tick()
			if (!disabled && !isSubmitting) {
				form.querySelector<HTMLTextAreaElement>('textarea')?.focus()
			}
		}
	}

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return

		event.preventDefault()
		;(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit()
	}
</script>

<form class="composer" onsubmit={handleSubmit}>
	<label class="message-label" for={id}>{label}</label>
	<div class="composer-field">
		<Textarea
			{id}
			bind:value
			required
			{maxlength}
			rows={2}
			disabled={disabled || isSubmitting}
			onkeydown={handleKeydown}
			{placeholder}
			--textarea-min-height="4rem"
			--textarea-max-height="12rem"
			--textarea-padding="0.82rem 4.2rem 0.82rem 1rem"
			--textarea-border="1px solid rgb(151 121 80 / 36%)"
			--textarea-radius="var(--border-radius-md)"
			--textarea-background="rgb(255 250 239 / 72%)"
			--textarea-color="#30291f"
		/>
		<button
			class="send-button"
			type="submit"
			aria-label={isSubmitting
				? 'Loremaster is thinking'
				: disabled
					? 'Message input disabled'
					: 'Send message'}
			disabled={disabled || isSubmitting || isHandlingSubmit || !value.trim()}
		>
			<Icon icon="lucide:send" aria-hidden="true" />
		</button>
	</div>
</form>

<style>
	.composer {
		display: grid;
		gap: 0.55rem;
	}

	label {
		display: grid;
		gap: 0.32rem;
		color: #4e422f;
		font-size: 0.84rem;
		font-weight: 600;
	}

	.message-label {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.composer-field {
		display: grid;
		position: relative;
		isolation: isolate;
	}

	.composer-field::before {
		position: absolute;
		z-index: 0;
		inset: -0.8px -1.1px -1.2px -0.6px;
		border: 1px solid rgb(132 99 60 / 32%);
		border-radius: 0.72rem 0.66rem / 0.62rem 0.76rem;
		pointer-events: none;
		content: '';
		transform: rotate(-0.08deg);
	}

	.composer-field :global(textarea) {
		position: relative;
		z-index: 1;
	}

	.send-button {
		position: absolute;
		z-index: 2;
		inset-block: 0;
		right: 1rem;
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		margin-block: auto;
		padding: 0;
		place-items: center;
		border: 1px solid rgb(137 108 70 / 22%);
		border-radius: 0.65rem;
		background: rgb(125 96 61 / 9%);
		color: #4b3d2d;
		cursor: pointer;
		transition:
			border-color 150ms ease,
			background-color 150ms ease,
			color 150ms ease;
	}

	.send-button :global(svg) {
		width: 1.35rem;
		height: 1.35rem;
	}

	.send-button:hover:not(:disabled) {
		border-color: rgb(137 108 70 / 38%);
		background: rgb(125 96 61 / 15%);
		color: #33281d;
	}

	.send-button:focus-visible {
		outline: 2px solid #9a7843;
		outline-offset: 2px;
	}

	.send-button:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}
</style>
