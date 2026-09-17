import { all, gen, succeed, type Effect } from 'effect/Effect'
import type * as TimelineDb from '../db/timeline'
import { fail, type Failure } from '../failure'
import type { VaultDocument } from '../vault/types'
import { temporalGraphProblem, temporalRelation } from './graph'
import type { TimelineContainment, TimelineContext, TimelineEdge } from './types'

export const DEFAULT_TIMELINE_DEPTH = 2
export const DEFAULT_TIMELINE_EVENT_LIMIT = 20
export const DEFAULT_TIMELINE_EDGE_LIMIT = 30

const emptyTimeline = (scope: TimelineContext['scope']): TimelineContext => ({
	scope,
	events: [],
	edges: [],
	containments: []
})

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

const resolveTimelineContainments = (
	documents: VaultDocument[]
): Effect<TimelineContainment[], Failure<'timeline', 'validateChronology'>> => {
	const documentsById = new Map(documents.map((document) => [document.id, document]))
	const containments: TimelineContainment[] = []
	for (const document of documents) {
		if ((document.during.length || document.eventForm) && document.type !== 'event') {
			return fail('timeline', 'validateChronology', {
				reason: 'eventChronologyOnNonEvent',
				documentId: document.id
			})
		}
		for (const periodDocumentId of document.during) {
			if (periodDocumentId === document.id) {
				return fail('timeline', 'validateChronology', {
					reason: 'selfContainment',
					documentId: document.id
				})
			}
			const period = documentsById.get(periodDocumentId)
			if (!period) continue
			if (period.type !== 'event') {
				return fail('timeline', 'validateChronology', {
					reason: 'periodIsNotEvent',
					documentId: document.id,
					periodDocumentId
				})
			}
			containments.push({ eventDocumentId: document.id, periodDocumentId })
		}
	}
	return succeed(containments)
}

export const timeline = ({
	db
}: {
	db: {
		getTimelineEdges: typeof TimelineDb.getTimelineEdges
		getTimelineEdgesForDocuments: typeof TimelineDb.getTimelineEdgesForDocuments
		getTimelineContainments: typeof TimelineDb.getTimelineContainments
		getTimelineContainmentsForDocuments: typeof TimelineDb.getTimelineContainmentsForDocuments
		getTimelineEvents: typeof TimelineDb.getTimelineEvents
		getCampaignTimelineEvents: typeof TimelineDb.getCampaignTimelineEvents
	}
}) => {
	const validateDocuments = (
		documents: VaultDocument[]
	): Effect<void, Failure<'timeline', 'validateChronology'>> =>
		gen(function* () {
			const edges = yield* resolveTimelineEdges(documents)
			const containments = yield* resolveTimelineContainments(documents)
			const problem = temporalGraphProblem(edges, containments)
			return problem
				? yield* fail('timeline', 'validateChronology', {
						reason: problem === 'precedence-cycle' ? 'cycle' : problem
					})
				: undefined
		})

	const getRelation = (campaignId: string, leftDocumentId: string, rightDocumentId: string) =>
		gen(function* () {
			const edges = yield* db.getTimelineEdges(campaignId)
			const containments = yield* db.getTimelineContainments(campaignId)
			return temporalRelation(leftDocumentId, rightDocumentId, edges, containments)
		})

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
			if (!seeds.length) return emptyTimeline('neighborhood')

			const visited = new Set(seeds)
			const edgesById = new Map<string, TimelineEdge>()
			const containmentsById = new Map<string, TimelineContainment>()
			let frontier = seeds

			for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
				const edges = yield* db.getTimelineEdgesForDocuments(campaignId, frontier)
				const containments = yield* db.getTimelineContainmentsForDocuments(campaignId, frontier)
				const next = new Set<string>()

				for (const relation of [...edges, ...containments]) {
					if (edgesById.size + containmentsById.size >= maxEdges) break
					const documentIds =
						'beforeDocumentId' in relation
							? [relation.beforeDocumentId, relation.afterDocumentId]
							: [relation.eventDocumentId, relation.periodDocumentId]
					const relationId = `${documentIds[0]}\0${documentIds[1]}`

					const newDocumentIds = documentIds.filter((documentId) => !visited.has(documentId))

					if (visited.size + newDocumentIds.length > maxEvents) continue

					if ('beforeDocumentId' in relation) edgesById.set(relationId, relation)
					else containmentsById.set(relationId, relation)
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
			const containments = [...containmentsById.values()].filter(
				({ eventDocumentId, periodDocumentId }) =>
					eventIds.has(eventDocumentId) && eventIds.has(periodDocumentId)
			)
			return {
				scope: 'neighborhood',
				events,
				edges,
				containments
			}
		})

	const getCampaignContext = (campaignId: string): Effect<TimelineContext, Failure> =>
		gen(function* () {
			const [events, edges, containments] = yield* all([
				db.getCampaignTimelineEvents(campaignId),
				db.getTimelineEdges(campaignId),
				db.getTimelineContainments(campaignId)
			])
			const eventIds = new Set(events.map(({ documentId }) => documentId))

			return {
				scope: 'campaign',
				events,
				edges: edges.filter(
					({ beforeDocumentId, afterDocumentId }) =>
						eventIds.has(beforeDocumentId) && eventIds.has(afterDocumentId)
				),
				containments: containments.filter(
					({ eventDocumentId, periodDocumentId }) =>
						eventIds.has(eventDocumentId) && eventIds.has(periodDocumentId)
				)
			}
		})

	return { getCampaignContext, getContext, getRelation, validateDocuments }
}
