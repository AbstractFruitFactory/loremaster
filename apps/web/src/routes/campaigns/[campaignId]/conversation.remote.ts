import { query } from '$app/server'
import { error } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import * as conversationDb from '#lib/server/db/conversation.js'
import { logFailure } from '#lib/server/failure.js'
import { requireCampaignOwner } from '#lib/server/auth/authorization.js'

const ownedQuery = <Schema extends z.ZodType, Output>(
	schema: Schema,
	callback: (input: z.output<Schema>) => Output | PromiseLike<Output>
) =>
	query(schema, async (input) => {
		await requireCampaignOwner(input as string)
		return callback(input as z.output<Schema>)
	})

export const getConversationHistory = ownedQuery(z.uuid(), (campaignId) =>
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
