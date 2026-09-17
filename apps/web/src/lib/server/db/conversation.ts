import { asc, desc, eq } from 'drizzle-orm'
import { map, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { LoreSource } from '../assistant/types'
import { failure } from '../failure'
import { db } from '.'
import { conversationMessages } from './schema'

export type ConversationMessage = typeof conversationMessages.$inferSelect

type NewConversationMessage = {
	role: ConversationMessage['role']
	content: string
	sources?: LoreSource[]
}

export const list = (campaignId: string) =>
	tryPromise({
		try: () =>
			db
				.select()
				.from(conversationMessages)
				.where(eq(conversationMessages.campaignId, campaignId))
				.orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id)),
		catch: (cause) => failure('database', 'listConversationMessages', cause)
	})

export const listRecent = (campaignId: string, limit: number) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select()
					.from(conversationMessages)
					.where(eq(conversationMessages.campaignId, campaignId))
					.orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
					.limit(limit),
			catch: (cause) => failure('database', 'listRecentConversationMessages', cause)
		}),
		map((messages) => messages.reverse())
	)

export const create = (campaignId: string, message: NewConversationMessage) =>
	tryPromise({
		try: () =>
			db
				.insert(conversationMessages)
				.values({
					campaignId,
					role: message.role,
					content: message.content,
					sources: message.sources ?? []
				})
				.returning(),
		catch: (cause) => failure('database', 'createConversationMessage', cause)
	})
