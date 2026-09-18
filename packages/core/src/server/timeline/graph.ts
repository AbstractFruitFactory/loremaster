import type { TimelineContainment, TimelineEdge, TimelineRelation } from './types.js'

const adjacency = (edges: TimelineEdge[]) => {
	const successors = new Map<string, Set<string>>()

	for (const { beforeDocumentId, afterDocumentId } of edges) {
		const documents = successors.get(beforeDocumentId) ?? new Set<string>()
		documents.add(afterDocumentId)
		successors.set(beforeDocumentId, documents)
	}

	return successors
}

const hasPath = (edges: TimelineEdge[], fromDocumentId: string, toDocumentId: string) => {
	const successors = adjacency(edges)
	const pending = [...(successors.get(fromDocumentId) ?? [])]
	const visited = new Set<string>()

	while (pending.length) {
		const documentId = pending.pop()!

		if (documentId === toDocumentId) return true
		if (visited.has(documentId)) continue

		visited.add(documentId)
		pending.push(...(successors.get(documentId) ?? []))
	}

	return false
}

export const timelineRelation =
	(leftDocumentId: string, rightDocumentId: string) =>
	(edges: TimelineEdge[]): TimelineRelation => {
		if (leftDocumentId === rightDocumentId) return 'same'
		if (hasPath(edges, leftDocumentId, rightDocumentId)) return 'before'
		if (hasPath(edges, rightDocumentId, leftDocumentId)) return 'after'

		return 'unknown'
	}

export const topologicalLayers = (
	documentIds: string[],
	edges: TimelineEdge[]
): string[][] | undefined => {
	const nodes = new Set(documentIds)

	for (const { beforeDocumentId, afterDocumentId } of edges) {
		nodes.add(beforeDocumentId)
		nodes.add(afterDocumentId)
	}

	const successors = adjacency(edges)
	const indegrees = new Map([...nodes].map((documentId) => [documentId, 0]))

	for (const documents of successors.values()) {
		for (const documentId of documents) {
			indegrees.set(documentId, (indegrees.get(documentId) ?? 0) + 1)
		}
	}

	const layers: string[][] = []
	let available = [...nodes].filter((documentId) => indegrees.get(documentId) === 0).sort()
	let visited = 0

	while (available.length) {
		layers.push(available)
		visited += available.length
		const next = new Set<string>()

		for (const documentId of available) {
			for (const successorId of successors.get(documentId) ?? []) {
				const indegree = (indegrees.get(successorId) ?? 0) - 1
				indegrees.set(successorId, indegree)
				if (indegree === 0) next.add(successorId)
			}
		}

		available = [...next].sort()
	}

	return visited === nodes.size ? layers : undefined
}

export const hasTimelineCycle = (edges: TimelineEdge[]) =>
	topologicalLayers([], edges) === undefined

const containmentEdges = (containments: TimelineContainment[]): TimelineEdge[] =>
	containments.map(({ eventDocumentId, periodDocumentId }) => ({
		beforeDocumentId: eventDocumentId,
		afterDocumentId: periodDocumentId
	}))

const containedEvents = (containments: TimelineContainment[]) => {
	const direct = new Map<string, Set<string>>()
	for (const { eventDocumentId, periodDocumentId } of containments) {
		const events = direct.get(periodDocumentId) ?? new Set<string>()
		events.add(eventDocumentId)
		direct.set(periodDocumentId, events)
	}

	const result = new Map<string, Set<string>>()
	const descendants = (periodDocumentId: string, visiting = new Set<string>()): Set<string> => {
		const cached = result.get(periodDocumentId)
		if (cached) return cached
		if (visiting.has(periodDocumentId)) return new Set()
		const nextVisiting = new Set(visiting).add(periodDocumentId)
		const events = new Set<string>()
		for (const eventDocumentId of direct.get(periodDocumentId) ?? []) {
			events.add(eventDocumentId)
			for (const nested of descendants(eventDocumentId, nextVisiting)) events.add(nested)
		}
		result.set(periodDocumentId, events)
		return events
	}

	for (const periodDocumentId of direct.keys()) descendants(periodDocumentId)
	return result
}

export const expandTimelineEdges = (
	edges: TimelineEdge[],
	containments: TimelineContainment[]
): TimelineEdge[] => {
	const containedByPeriod = containedEvents(containments)
	const expanded = new Map<string, TimelineEdge>()
	for (const edge of edges) {
		const beforeIds = [
			edge.beforeDocumentId,
			...(containedByPeriod.get(edge.beforeDocumentId) ?? [])
		]
		const afterIds = [edge.afterDocumentId, ...(containedByPeriod.get(edge.afterDocumentId) ?? [])]
		for (const beforeDocumentId of beforeIds) {
			for (const afterDocumentId of afterIds) {
				const key = `${beforeDocumentId}\0${afterDocumentId}`
				expanded.set(key, { beforeDocumentId, afterDocumentId })
			}
		}
	}
	return [...expanded.values()]
}

export const temporalRelation = (
	leftDocumentId: string,
	rightDocumentId: string,
	edges: TimelineEdge[],
	containments: TimelineContainment[]
) => timelineRelation(leftDocumentId, rightDocumentId)(expandTimelineEdges(edges, containments))

export type TemporalGraphProblem =
	'precedence-cycle' | 'containment-cycle' | 'containment-order-conflict'

export const temporalGraphProblem = (
	edges: TimelineEdge[],
	containments: TimelineContainment[]
): TemporalGraphProblem | undefined => {
	if (hasTimelineCycle(containmentEdges(containments))) return 'containment-cycle'
	const expanded = expandTimelineEdges(edges, containments)
	const containedByPeriod = containedEvents(containments)
	for (const [periodDocumentId, eventDocumentIds] of containedByPeriod) {
		for (const eventDocumentId of eventDocumentIds) {
			if (timelineRelation(eventDocumentId, periodDocumentId)(expanded) !== 'unknown') {
				return 'containment-order-conflict'
			}
		}
	}
	if (hasTimelineCycle(expanded)) return 'precedence-cycle'
	return undefined
}
