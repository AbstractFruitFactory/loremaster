import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { candidateRetrieval } from './candidates.js'
import type { ContextSource } from './types.js'

const source = (documentId: string, title: string, position = 0): ContextSource => ({
	fragment: {
		id: `${documentId}:${position}`,
		campaignId: 'campaign',
		documentId,
		title,
		documentType: 'npc',
		content: title,
		position,
		contentHash: `${documentId}:${position}:hash`
	}
})

const setup = () => {
	const sources = [
		source('exact', 'Varek'),
		source('lexical', 'Western Gate'),
		source('lexical', 'Western Gate', 1),
		source('semantic', 'Gatehouse'),
		source('neighbor', 'Gate Captain')
	]
	const sourcesById = new Map(sources.map((item) => [item.fragment.id, item]))
	const db = {
		findDocumentIdsByNames: vi.fn(() => succeed(['fragmentless', 'exact', 'exact'])),
		getFragmentsForDocuments: vi.fn((_campaignId: string, documentIds: string[]) =>
			succeed(sources.filter(({ fragment }) => documentIds.includes(fragment.documentId)))
		),
		searchLexicalFragments: vi.fn(() =>
			succeed([
				{ source: sourcesById.get('lexical:1')!, score: 0.5 },
				{ source: sourcesById.get('exact:0')!, score: 10 },
				{ source: sourcesById.get('lexical:0')!, score: 2 }
			])
		),
		searchVectors: vi.fn(() =>
			succeed([
				{ fragmentId: 'semantic:0', score: 0.9 },
				{ fragmentId: 'lexical:0', score: 0.8 }
			])
		),
		getFragmentsByIds: vi.fn((_campaignId: string, fragmentIds: string[]) =>
			succeed(fragmentIds.flatMap((fragmentId) => sourcesById.get(fragmentId) ?? []))
		),
		getOutgoingLinksForDocuments: vi.fn(() =>
			succeed([{ seedDocumentId: 'exact', documentId: 'neighbor' }])
		),
		getBacklinksForDocuments: vi.fn(() =>
			succeed([{ seedDocumentId: 'lexical', documentId: 'neighbor' }])
		),
		getOutgoingRelationshipLinksForDocuments: vi.fn(() => succeed([])),
		getIncomingRelationshipLinksForDocuments: vi.fn(() => succeed([]))
	}
	const ai = {
		model: 'embedding-model',
		embedTexts: vi.fn(() => succeed([[1, 0]]))
	}

	return { ai, db, retrieval: candidateRetrieval({ ai, db }) }
}

describe('candidate retrieval', () => {
	it('returns fragmentless exact IDs and deterministic ranked candidates', async () => {
		const { retrieval } = setup()
		const input = {
			campaignId: 'campaign',
			exactNames: ['Várek', 'Varek'],
			lexicalQuery: 'Varek opened the western gate.',
			semanticQuery: 'The gatehouse watch changed.',
			graph: {
				selectSeedDocumentIds: () => ['exact', 'lexical']
			}
		}

		const first = await runPromise(retrieval.retrieve(input))
		const second = await runPromise(retrieval.retrieve(input))

		expect(first.exactDocumentIds).toEqual(['exact', 'fragmentless'])
		expect(first.exactCandidates.map(({ fragment }) => fragment.documentId)).toEqual(['exact'])
		expect(first.rankedCandidates.map(({ fragment }) => fragment.documentId)).toEqual([
			'exact',
			'lexical',
			'lexical',
			'semantic',
			'neighbor'
		])
		expect(
			first.rankedCandidates.find(({ fragment }) => fragment.documentId === 'neighbor')?.reasons
		).toEqual(['wiki-link', 'backlink'])
		expect(second).toEqual(first)
	})

	it('passes finite graph bounds to every graph query', async () => {
		const { db, retrieval } = setup()
		const result = await runPromise(
			retrieval.retrieve({
				campaignId: 'campaign',
				exactDocumentIds: ['exact'],
				graph: {
					selectSeedDocumentIds: () => ['exact'],
					queryLimit: 12,
					resultLimit: 6
				}
			})
		)

		expect(result.graphSeedDocumentIds).toEqual(['exact'])
		for (const graphQuery of [
			db.getOutgoingLinksForDocuments,
			db.getBacklinksForDocuments,
			db.getOutgoingRelationshipLinksForDocuments,
			db.getIncomingRelationshipLinksForDocuments
		]) {
			expect(graphQuery).toHaveBeenCalledWith('campaign', ['exact'], 12)
		}
	})
})
