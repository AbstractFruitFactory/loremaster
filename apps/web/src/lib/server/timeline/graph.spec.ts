import { describe, expect, it } from 'vitest'
import {
	hasTimelineCycle,
	temporalGraphProblem,
	temporalRelation,
	timelineRelation,
	topologicalLayers
} from './graph'
import type { TimelineContainment, TimelineEdge } from './types'

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

	it('inherits period boundaries without ordering events in the same period', () => {
		const periodEdges: TimelineEdge[] = [
			{ beforeDocumentId: 'age-before', afterDocumentId: 'goblin-wars' },
			{ beforeDocumentId: 'goblin-wars', afterDocumentId: 'age-after' }
		]
		const containments: TimelineContainment[] = [
			{ eventDocumentId: 'red-pass', periodDocumentId: 'goblin-wars' },
			{ eventDocumentId: 'river-siege', periodDocumentId: 'goblin-wars' }
		]

		expect(temporalRelation('age-before', 'red-pass', periodEdges, containments)).toBe('before')
		expect(temporalRelation('red-pass', 'age-after', periodEdges, containments)).toBe('before')
		expect(temporalRelation('red-pass', 'river-siege', periodEdges, containments)).toBe('unknown')
	})

	it('supports nested containment and rejects contradictory temporal constraints', () => {
		const containments: TimelineContainment[] = [
			{ eventDocumentId: 'battle', periodDocumentId: 'campaign' },
			{ eventDocumentId: 'campaign', periodDocumentId: 'goblin-wars' }
		]
		const edges: TimelineEdge[] = [{ beforeDocumentId: 'goblin-wars', afterDocumentId: 'peace' }]

		expect(temporalRelation('battle', 'peace', edges, containments)).toBe('before')
		expect(temporalGraphProblem(edges, containments)).toBeUndefined()
		expect(
			temporalGraphProblem(
				[{ beforeDocumentId: 'battle', afterDocumentId: 'goblin-wars' }],
				containments
			)
		).toBe('containment-order-conflict')
		expect(
			temporalGraphProblem(
				[],
				[...containments, { eventDocumentId: 'goblin-wars', periodDocumentId: 'battle' }]
			)
		).toBe('containment-cycle')
	})
})
