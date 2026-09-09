import type { AssistantStreamEvent } from '#lib/server/assistant/types.js'

export type AssistantStreamInput = {
	message: string
	history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type AssistantStreamOptions = {
	signal?: AbortSignal
	fetcher?: typeof fetch
}

const getResponseError = async (response: Response) => {
	const fallback = `Assistant request failed (${response.status})`
	const body = await response.text()

	if (!body) return fallback

	try {
		const parsed: unknown = JSON.parse(body)
		if (
			parsed &&
			typeof parsed === 'object' &&
			'message' in parsed &&
			typeof parsed.message === 'string'
		) {
			return parsed.message
		}
	} catch {
		return body
	}

	return fallback
}

const parseEvent = (line: string): AssistantStreamEvent => {
	try {
		return JSON.parse(line) as AssistantStreamEvent
	} catch {
		throw new Error('Loremaster returned an invalid stream frame')
	}
}

export async function* streamAssistant(
	campaignId: string,
	input: AssistantStreamInput,
	{ signal, fetcher = fetch }: AssistantStreamOptions = {}
): AsyncGenerator<AssistantStreamEvent> {
	const response = await fetcher(`/api/campaigns/${encodeURIComponent(campaignId)}/assistant`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/x-ndjson'
		},
		body: JSON.stringify(input),
		signal
	})

	if (!response.ok) {
		throw new Error(await getResponseError(response))
	}

	if (!response.body) {
		throw new Error('Loremaster returned an empty response')
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let completed = false
	let readerDone = false

	try {
		while (true) {
			const { done, value } = await reader.read()
			readerDone = done
			buffer += decoder.decode(value, { stream: !done })

			const lines = buffer.split('\n')
			buffer = lines.pop() ?? ''

			for (const line of lines) {
				const trimmedLine = line.trim()
				if (!trimmedLine) continue

				const event = parseEvent(trimmedLine)
				yield event

				if (event.type === 'done' || event.type === 'error') {
					completed = true
					return
				}
			}

			if (done) break
		}

		const trailingLine = buffer.trim()
		if (trailingLine) {
			const event = parseEvent(trailingLine)
			yield event
			completed = event.type === 'done' || event.type === 'error'
		}
	} finally {
		if (!readerDone) {
			await reader.cancel().catch(() => undefined)
		}
		reader.releaseLock()
	}

	if (!completed) {
		throw new Error('Loremaster response ended unexpectedly')
	}
}
