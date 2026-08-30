import { describe, expect, it } from 'vitest'
import { hasTimelineCycle, timelineRelation, topologicalLayers } from './graph'
import type { TimelineEdge } from './types'

const edges: TimelineEdge[] = [
	{ beforeDocumentId: 'a', afterDocumentId: 'b' },
	{ beforeDocumentId: 'b', afterDocumentId: 'c' },
	{ beforeDocumentId: 'b', afterDocumentId: 'd' },
	{ beforeDocumentId: 'c', afterDocumentId: 'e' },
	{ beforeDocumentId: 'd', afterDocumentId: 'e' }
]

describe('timeline graph', () => {
	it('derives deterministic layers for branch-and-join chronology', () => {
		expect(topologicalLayers(['a', 'b', 'c', 'd', 'e'], edges)).toEqual([
			['a'],
			['b'],
			['c', 'd'],
			['e']
		])
	})

	it('derives transitive ordering while preserving unknown ordering', () => {
		expect(timelineRelation('a', 'e')(edges)).toBe('before')
		expect(timelineRelation('e', 'a')(edges)).toBe('after')
		expect(timelineRelation('c', 'd')(edges)).toBe('unknown')
		expect(timelineRelation('c', 'c')(edges)).toBe('same')
	})

	it('detects cycles', () => {
		expect(hasTimelineCycle([...edges, { beforeDocumentId: 'e', afterDocumentId: 'a' }])).toBe(true)
		expect(hasTimelineCycle(edges)).toBe(false)
	})
})
