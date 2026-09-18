import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { TimelineContainment, TimelineEdge, TimelineEvent } from '../timeline/types.js'
import { failure } from '../failure.js'
import { db } from './index.js'
import { eventChronologyEdges, eventDuringEdges, vaultDocuments } from './schema.js'

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

export const getTimelineContainments = (campaignId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select({
						eventDocumentId: eventDuringEdges.eventDocumentId,
						periodDocumentId: eventDuringEdges.periodDocumentId
					})
					.from(eventDuringEdges)
					.where(eq(eventDuringEdges.campaignId, campaignId))
					.orderBy(asc(eventDuringEdges.eventDocumentId), asc(eventDuringEdges.periodDocumentId)),
			catch: (cause) => failure('database', 'getTimelineContainments', cause)
		}),
		map((containments): TimelineContainment[] => containments)
	)

export const getTimelineContainmentsForDocuments = (campaignId: string, documentIds: string[]) => {
	if (!documentIds.length) return succeed([])
	return pipe(
		tryPromise({
			try: () =>
				db
					.select({
						eventDocumentId: eventDuringEdges.eventDocumentId,
						periodDocumentId: eventDuringEdges.periodDocumentId
					})
					.from(eventDuringEdges)
					.where(
						and(
							eq(eventDuringEdges.campaignId, campaignId),
							or(
								inArray(eventDuringEdges.eventDocumentId, documentIds),
								inArray(eventDuringEdges.periodDocumentId, documentIds)
							)
						)
					)
					.orderBy(asc(eventDuringEdges.eventDocumentId), asc(eventDuringEdges.periodDocumentId)),
			catch: (cause) => failure('database', 'getTimelineContainmentsForDocuments', cause)
		}),
		map((containments): TimelineContainment[] => containments)
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

export const getCampaignTimelineEvents = (campaignId: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select({
						documentId: vaultDocuments.documentId,
						title: vaultDocuments.title
					})
					.from(vaultDocuments)
					.where(and(eq(vaultDocuments.campaignId, campaignId), eq(vaultDocuments.type, 'event')))
					.orderBy(asc(vaultDocuments.documentId)),
			catch: (cause) => failure('database', 'getCampaignTimelineEvents', cause)
		}),
		map((events): TimelineEvent[] => events)
	)
