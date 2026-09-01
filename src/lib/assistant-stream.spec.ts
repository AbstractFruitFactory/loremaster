import { describe, expect, it, vi } from 'vitest'
import { streamAssistant } from './assistant-stream'

const encoder = new TextEncoder()

const createStreamResponse = (chunks: string[], status = 200) =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) {
					controller.enqueue(encoder.encode(chunk))
				}
				controller.close()
			}
		}),
		{
			status,
			headers: { 'content-type': 'application/x-ndjson' }
		}
	)

describe('streamAssistant', () => {
	it('posts the request and decodes frames split across chunks', async () => {
		const controller = new AbortController()
		const fetcher = vi.fn(() =>
			Promise.resolve(
				createStreamResponse([
					'{"type":"sources","sources":[]}\n{"type":"text-',
					'delta","delta":"The gate"}\n{"type":"done"}\n'
				])
			)
		)

		const events = []
		for await (const event of streamAssistant(
			'campaign id',
			{
				message: 'Who guards the gate?',
				history: [{ role: 'user', content: 'Hello' }]
			},
			{ signal: controller.signal, fetcher }
		)) {
			events.push(event)
		}

		expect(events).toEqual([
			{ type: 'sources', sources: [] },
			{ type: 'text-delta', delta: 'The gate' },
			{ type: 'done' }
		])
		expect(fetcher).toHaveBeenCalledWith('/api/campaigns/campaign%20id/assistant', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/x-ndjson'
			},
			body: JSON.stringify({
				message: 'Who guards the gate?',
				history: [{ role: 'user', content: 'Hello' }]
			}),
			signal: controller.signal
		})
	})

	it('decodes a terminal frame without a trailing newline', async () => {
		const events = []

		for await (const event of streamAssistant(
			'campaign',
			{ message: 'Hello', history: [] },
			{
				fetcher: () =>
					Promise.resolve(
						createStreamResponse(['{"type":"text-delta","delta":"Hello"}\n{"type":"done"}'])
					)
			}
		)) {
			events.push(event)
		}

		expect(events).toEqual([{ type: 'text-delta', delta: 'Hello' }, { type: 'done' }])
	})

	it('surfaces endpoint error messages', async () => {
		const consume = async () => {
			for await (const event of streamAssistant(
				'campaign',
				{ message: 'Hello', history: [] },
				{
					fetcher: () =>
						Promise.resolve(
							new Response(JSON.stringify({ message: 'OpenAI is not configured' }), {
								status: 503
							})
						)
				}
			)) {
				void event
			}
		}

		await expect(consume()).rejects.toThrow('OpenAI is not configured')
	})

	it('rejects malformed frames', async () => {
		const consume = async () => {
			for await (const event of streamAssistant(
				'campaign',
				{ message: 'Hello', history: [] },
				{
					fetcher: () => Promise.resolve(createStreamResponse(['not-json\n']))
				}
			)) {
				void event
			}
		}

		await expect(consume()).rejects.toThrow('Loremaster returned an invalid stream frame')
	})

	it('rejects streams that end without a terminal frame', async () => {
		const consume = async () => {
			for await (const event of streamAssistant(
				'campaign',
				{ message: 'Hello', history: [] },
				{
					fetcher: () =>
						Promise.resolve(createStreamResponse(['{"type":"text-delta","delta":"Partial"}\n']))
				}
			)) {
				void event
			}
		}

		await expect(consume()).rejects.toThrow('Loremaster response ended unexpectedly')
	})

	it('cancels an unfinished reader when iteration stops early', async () => {
		const cancel = vi.fn()
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode('{"type":"sources","sources":[]}\n'))
				},
				cancel
			})
		)
		const events = streamAssistant(
			'campaign',
			{ message: 'Hello', history: [] },
			{ fetcher: () => Promise.resolve(response) }
		)

		await expect(events.next()).resolves.toEqual({
			done: false,
			value: { type: 'sources', sources: [] }
		})
		await events.return(undefined)

		expect(cancel).toHaveBeenCalledOnce()
	})
})
