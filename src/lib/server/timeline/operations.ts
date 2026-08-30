import { flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type * as TimelineDb from '../db/timeline'
import { fail, type Failure } from '../failure'
import type { VaultDocument } from '../vault/types'
import { hasTimelineCycle, timelineRelation, topologicalLayers } from './graph'
import type { TimelineContext, TimelineEdge } from './types'

export const DEFAULT_TIMELINE_DEPTH = 2
export const DEFAULT_TIMELINE_EVENT_LIMIT = 20
export const DEFAULT_TIMELINE_EDGE_LIMIT = 30

const emptyTimeline = (): TimelineContext => ({ events: [], edges: [], layers: [] })

const resolveTimelineEdges = (
	documents: VaultDocument[]
): Effect<TimelineEdge[], Failure<'timeline', 'validateChronology'>> => {
	const documentsById = new Map(documents.map((document) => [document.id, document]))
	const edges: TimelineEdge[] = []

	for (const document of documents) {
		if (document.after.length && document.type !== 'event') {
			return fail('timeline', 'validateChronology', {
				reason: 'eventPredecessorsOnNonEvent',
				documentId: document.id
			})
		}

		for (const beforeDocumentId of document.after) {
			if (beforeDocumentId === document.id) {
				return fail('timeline', 'validateChronology', {
					reason: 'selfReference',
					documentId: document.id
				})
			}

			const predecessor = documentsById.get(beforeDocumentId)

			if (!predecessor) continue
			if (predecessor.type !== 'event') {
				return fail('timeline', 'validateChronology', {
					reason: 'predecessorIsNotEvent',
					documentId: document.id,
					beforeDocumentId
				})
			}

			edges.push({
				beforeDocumentId,
				afterDocumentId: document.id
			})
		}
	}

	return succeed(edges)
}

export const timelineOperations = ({
	db
}: {
	db: {
		getTimelineEdges: typeof TimelineDb.getTimelineEdges
		getTimelineEdgesForDocuments: typeof TimelineDb.getTimelineEdgesForDocuments
		getTimelineEvents: typeof TimelineDb.getTimelineEvents
	}
}) => {
	const validateDocuments = (
		documents: VaultDocument[]
	): Effect<void, Failure<'timeline', 'validateChronology'>> =>
		pipe(
			resolveTimelineEdges(documents),
			flatMap((edges) =>
				hasTimelineCycle(edges)
					? fail('timeline', 'validateChronology', { reason: 'cycle' })
					: succeed(undefined)
			)
		)

	const getRelation = (campaignId: string, leftDocumentId: string, rightDocumentId: string) =>
		pipe(
			db.getTimelineEdges(campaignId),
			map(timelineRelation(leftDocumentId, rightDocumentId))
		)

	const getContext = (
		campaignId: string,
		seedDocumentIds: string[],
		{
			maxDepth = DEFAULT_TIMELINE_DEPTH,
			maxEvents = DEFAULT_TIMELINE_EVENT_LIMIT,
			maxEdges = DEFAULT_TIMELINE_EDGE_LIMIT
		}: {
			maxDepth?: number
			maxEvents?: number
			maxEdges?: number
		} = {}
	): Effect<TimelineContext, Failure> =>
		gen(function* () {
			const seeds = [...new Set(seedDocumentIds)].slice(0, maxEvents)
			if (!seeds.length) return emptyTimeline()

			const visited = new Set(seeds)
			const edgesById = new Map<string, TimelineEdge>()
			let frontier = seeds

			for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
				const edges = yield* db.getTimelineEdgesForDocuments(campaignId, frontier)
				const next = new Set<string>()

				for (const edge of edges) {
					if (edgesById.size >= maxEdges) break

					const edgeId = `${edge.beforeDocumentId}\0${edge.afterDocumentId}`
					const newDocumentIds = [edge.beforeDocumentId, edge.afterDocumentId].filter(
						(documentId) => !visited.has(documentId)
					)

					if (visited.size + newDocumentIds.length > maxEvents) continue

					edgesById.set(edgeId, edge)
					for (const documentId of newDocumentIds) {
						visited.add(documentId)
						next.add(documentId)
					}
				}

				frontier = [...next].sort()
			}

			const events = yield* db.getTimelineEvents(campaignId, [...visited])
			const eventIds = new Set(events.map(({ documentId }) => documentId))
			const edges = [...edgesById.values()].filter(
				({ beforeDocumentId, afterDocumentId }) =>
					eventIds.has(beforeDocumentId) && eventIds.has(afterDocumentId)
			)
			const layers = topologicalLayers(
				events.map(({ documentId }) => documentId),
				edges
			)

			return {
				events,
				edges,
				layers: layers ?? []
			}
		})

	return { getContext, getRelation, validateDocuments }
}
