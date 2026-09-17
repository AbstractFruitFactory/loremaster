import { query } from '$app/server'
import { error } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import * as conversationDb from '#lib/server/db/conversation.js'
import { logFailure } from '#lib/server/failure.js'

export const getConversationHistory = query(z.uuid(), (campaignId) =>
	runPromise(
		pipe(
			conversationDb.list(campaignId),
			match({
				onFailure: (failure) => {
					logFailure(failure)
					error(500, 'Unable to load conversation')
				},
				onSuccess: (messages) =>
					messages.map(({ id, role, content, sources }) => ({ id, role, content, sources }))
			})
		)
	)
)
