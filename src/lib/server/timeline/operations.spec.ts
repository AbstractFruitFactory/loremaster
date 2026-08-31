import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../vault/types'
import { timelineOperations } from './operations'
import type { TimelineEdge } from './types'

const event = (id: string, after: string[] = []): VaultDocument => ({
	id,
	path: `Events/${id}.md`,
	title: `Event ${id.toUpperCase()}`,
	type: 'event',
	after,
	summary: '',
	content: `# Event ${id.toUpperCase()}`,
	links: []
})

const edges: TimelineEdge[] = [
	{ beforeDocumentId: 'a', afterDocumentId: 'b' },
	{ beforeDocumentId: 'b', afterDocumentId: 'c' },
	{ beforeDocumentId: 'c', afterDocumentId: 'd' }
]

const createTimeline = () => {
	const db = {
		getTimelineEdges: vi.fn(() => succeed(edges)),
		getTimelineEdgesForDocuments: vi.fn((_campaignId: string, documentIds: string[]) =>
			succeed(
				edges.filter(
					({ beforeDocumentId, afterDocumentId }) =>
						documentIds.includes(beforeDocumentId) || documentIds.includes(afterDocumentId)
				)
			)
		),
		getTimelineEvents: vi.fn((_campaignId: string, documentIds: string[]) =>
			succeed(
				documentIds
					.sort()
					.map((documentId) => ({ documentId, title: `Event ${documentId.toUpperCase()}` }))
			)
		)
	}

	return { db, timeline: timelineOperations({ db }) }
}

describe('timeline operations', () => {
	it('validates branch-and-join chronology and unresolved predecessors', async () => {
		const { timeline } = createTimeline()

		await expect(
			runPromise(
				timeline.validateDocuments([
					event('a'),
					event('b', ['a']),
					event('c', ['b']),
					event('d', ['b']),
					event('e', ['c', 'd', 'not-imported-yet'])
				])
			)
		).resolves.toBeUndefined()
	})

	it('rejects self references, non-event predecessors, and cycles', async () => {
		const { timeline } = createTimeline()
		const npc: VaultDocument = {
			id: 'npc',
			path: 'NPCs/npc.md',
			title: 'NPC',
			type: 'npc',
			after: [],
			summary: '',
			content: '# NPC',
			links: []
		}

		await expect(
			runPromise(flip(timeline.validateDocuments([event('a', ['a'])])))
		).resolves.toMatchObject({
			cause: { reason: 'selfReference' }
		})
		await expect(
			runPromise(flip(timeline.validateDocuments([npc, event('a', ['npc'])])))
		).resolves.toMatchObject({
			cause: { reason: 'predecessorIsNotEvent' }
		})
		await expect(
			runPromise(
				flip(timeline.validateDocuments([event('a', ['c']), event('b', ['a']), event('c', ['b'])]))
			)
		).resolves.toMatchObject({
			cause: { reason: 'cycle' }
		})
	})

	it('answers transitive ordering from the complete derived graph', async () => {
		const { timeline } = createTimeline()

		await expect(runPromise(timeline.getRelation('campaign', 'a', 'd'))).resolves.toBe('before')
		await expect(runPromise(timeline.getRelation('campaign', 'a', 'unknown'))).resolves.toBe(
			'unknown'
		)
	})

	it('loads only the configured timeline neighborhood', async () => {
		const { db, timeline } = createTimeline()

		const immediate = await runPromise(timeline.getContext('campaign', ['b'], { maxDepth: 1 }))
		const expanded = await runPromise(timeline.getContext('campaign', ['b'], { maxDepth: 2 }))

		expect(immediate.events.map(({ documentId }) => documentId)).toEqual(['a', 'b', 'c'])
		expect(expanded.events.map(({ documentId }) => documentId)).toEqual(['a', 'b', 'c', 'd'])
		expect(expanded.layers).toEqual([['a'], ['b'], ['c'], ['d']])
		expect(db.getTimelineEdgesForDocuments).toHaveBeenCalledTimes(3)
	})

	it('caps timeline events and edges deterministically', async () => {
		const { timeline } = createTimeline()

		const result = await runPromise(
			timeline.getContext('campaign', ['b'], {
				maxDepth: 2,
				maxEvents: 2,
				maxEdges: 1
			})
		)

		expect(result.events.map(({ documentId }) => documentId)).toEqual(['a', 'b'])
		expect(result.edges).toEqual([{ beforeDocumentId: 'a', afterDocumentId: 'b' }])
	})
})
