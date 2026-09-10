import { json } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import { assistant } from '#lib/server/app.js'
import { askLoremasterRequestSchema } from '#lib/server/assistant/schema.js'
import type { AssistantStreamEvent } from '#lib/server/assistant/types.js'
import * as conversationDb from '#lib/server/db/conversation.js'
import { logFailure } from '#lib/server/failure.js'
import type { RequestHandler } from './$types'

const campaignIdSchema = z.uuid()
const conversationHistoryLimit = 12
const encoder = new TextEncoder()
const encodeEvent = (event: AssistantStreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`)

export const POST: RequestHandler = async ({ params, request }) => {
	const campaignId = campaignIdSchema.safeParse(params.campaignId)
	if (!campaignId.success) {
		return json({ message: 'Invalid campaign ID' }, { status: 400 })
	}

	const body = askLoremasterRequestSchema.safeParse(await request.json().catch(() => null))
	if (!body.success) {
		return json({ message: 'Invalid assistant request' }, { status: 400 })
	}

	const historyResult = await runPromise(
		pipe(
			conversationDb.listRecent(campaignId.data, conversationHistoryLimit),
			match({
				onFailure: (failure) => ({ failure }),
				onSuccess: (messages) => ({ messages })
			})
		)
	)

	if ('failure' in historyResult) {
		logFailure(historyResult.failure)
		return json({ message: 'Unable to load conversation history' }, { status: 500 })
	}

	const userMessageResult = await runPromise(
		pipe(
			conversationDb.create(campaignId.data, {
				role: 'user',
				content: body.data.message
			}),
			match({
				onFailure: (failure) => ({ failure }),
				onSuccess: (messages) => ({ messages })
			})
		)
	)

	if ('failure' in userMessageResult) {
		logFailure(userMessageResult.failure)
		return json({ message: 'Unable to save conversation' }, { status: 500 })
	}

	const history = historyResult.messages.map(({ role, content }) => ({ role, content }))
	const result = await runPromise(
		pipe(
			assistant.streamChat(campaignId.data, body.data.message, history, request.signal),
			match({
				onFailure: (failure) => ({ failure }),
				onSuccess: (stream) => ({ stream })
			})
		)
	)

	if ('failure' in result) {
		logFailure(result.failure)

		if (result.failure.domain === 'campaign') {
			return json({ message: `Campaign "${campaignId.data}" was not found` }, { status: 404 })
		}

		const reason =
			result.failure.cause &&
			typeof result.failure.cause === 'object' &&
			'reason' in result.failure.cause
				? result.failure.cause.reason
				: undefined

		if (reason === 'missingOpenAiApiKey') {
			return json({ message: 'OpenAI is not configured' }, { status: 503 })
		}

		return json({ message: 'Loremaster could not respond' }, { status: 500 })
	}

	const responseBody = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(encodeEvent({ type: 'sources', sources: result.stream.sources }))
			let assistantContent = ''

			try {
				for await (const event of result.stream.events) {
					if (event.type === 'text-delta') assistantContent += event.delta
					controller.enqueue(encodeEvent(event))
				}

				if (assistantContent.trim()) {
					const assistantMessageResult = await runPromise(
						pipe(
							conversationDb.create(campaignId.data, {
								role: 'assistant',
								content: assistantContent,
								sources: result.stream.sources
							}),
							match({
								onFailure: (failure) => ({ failure }),
								onSuccess: (messages) => ({ messages })
							})
						)
					)

					if ('failure' in assistantMessageResult) {
						logFailure(assistantMessageResult.failure)
						controller.enqueue(
							encodeEvent({
								type: 'error',
								message: 'Loremaster responded, but the conversation could not be saved'
							})
						)
						return
					}
				}

				controller.enqueue(encodeEvent({ type: 'done' }))
			} catch (cause) {
				if (!request.signal.aborted) {
					console.error('[assistant.stream]', cause)
					controller.enqueue(
						encodeEvent({
							type: 'error',
							message: 'Loremaster could not complete the response'
						})
					)
				}
			} finally {
				controller.close()
			}
		}
	})

	return new Response(responseBody, {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/x-ndjson; charset=utf-8',
			'x-content-type-options': 'nosniff'
		}
	})
}
