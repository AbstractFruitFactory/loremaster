import type { TimelineEdge, TimelineRelation } from './types'

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
