import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { TimelineEdge, TimelineEvent } from '../timeline/types'
import { failure } from '../failure'
import { db } from '.'
import { eventChronologyEdges, vaultDocuments } from './schema'

export const getTimelineEdges = (campaignId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select({
						beforeDocumentId: eventChronologyEdges.beforeDocumentId,
						afterDocumentId: eventChronologyEdges.afterDocumentId
					})
					.from(eventChronologyEdges)
					.where(eq(eventChronologyEdges.campaignId, campaignId))
					.orderBy(
						asc(eventChronologyEdges.beforeDocumentId),
						asc(eventChronologyEdges.afterDocumentId)
					),
			catch: (cause) => failure('database', 'getTimelineEdges', cause)
		}),
		map((edges): TimelineEdge[] => edges)
	)

export const getTimelineEdgesForDocuments = (campaignId: string, documentIds: string[]) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () =>
				db
					.select({
						beforeDocumentId: eventChronologyEdges.beforeDocumentId,
						afterDocumentId: eventChronologyEdges.afterDocumentId
					})
					.from(eventChronologyEdges)
					.where(
						and(
							eq(eventChronologyEdges.campaignId, campaignId),
							or(
								inArray(eventChronologyEdges.beforeDocumentId, documentIds),
								inArray(eventChronologyEdges.afterDocumentId, documentIds)
							)
						)
					)
					.orderBy(
						asc(eventChronologyEdges.beforeDocumentId),
						asc(eventChronologyEdges.afterDocumentId)
					),
			catch: (cause) => failure('database', 'getTimelineEdgesForDocuments', cause)
		}),
		map((edges): TimelineEdge[] => edges)
	)
}

export const getTimelineEvents = (campaignId: string, documentIds: string[]) => {
	if (!documentIds.length) return succeed([])

	return pipe(
		tryPromise({
			try: () =>
				db
					.select({
						documentId: vaultDocuments.documentId,
						title: vaultDocuments.title
					})
					.from(vaultDocuments)
					.where(
						and(
							eq(vaultDocuments.campaignId, campaignId),
							eq(vaultDocuments.type, 'event'),
							inArray(vaultDocuments.documentId, documentIds)
						)
					)
					.orderBy(asc(vaultDocuments.documentId)),
			catch: (cause) => failure('database', 'getTimelineEvents', cause)
		}),
		map((events): TimelineEvent[] => events)
	)
}
