import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateRetrievalResult, DirectCandidateResult } from '../context/candidates.js'
import type { ContextItem } from '../context/types.js'
import { ingestionContext, MAX_INGESTION_ANALYSIS_DOCUMENTS } from './context.js'
import type { SessionValidatedClaim } from './types.js'

const item = (documentId: string): ContextItem => ({
	fragment: {
		id: `${documentId}:0`,
		campaignId: 'campaign',
		documentId,
		title: documentId,
		documentType: 'npc',
		content: documentId,
		position: 0,
		contentHash: `${documentId}:hash`
	},
	score: 50,
	reasons: ['lexical-match']
})

const claim: SessionValidatedClaim = {
	claimId: 'claim',
	kind: 'development',
	eventTitle: 'Western gate opened',
	certainty: 'explicit',
	content: 'Varek opened the western gate.',
	entityReferences: [{ label: 'Varek', type: 'npc' }],
	evidence: [
		{
			excerpt: 'Unaudited transcript-only chatter.',
			chunkId: 'chunk-1',
			startStringIndex: 0,
			endStringIndex: 10,
			startLine: 1,
			endLine: 1
		}
	]
}

const retrievalResult = (
	rankedDirectCandidates: ContextItem[],
	graphSeedDocumentIds: string[],
	rankedGraphCandidates: ContextItem[] = []
): CandidateRetrievalResult => ({
	exactDocumentIds: ['exact'],
	exactCandidates: [],
	lexicalCandidates: rankedDirectCandidates.map(({ fragment, score, reasons }) => ({
		fragment,
		score,
		reasons
	})),
	semanticCandidates: [],
	graphSeedDocumentIds,
	graphCandidates: rankedGraphCandidates.map(({ fragment, score, reasons }) => ({
		fragment,
		score,
		reasons
	})),
	rankedDirectCandidates,
	rankedGraphCandidates,
	rankedCandidates: [...rankedDirectCandidates, ...rankedGraphCandidates]
})

describe('ingestion context policy', () => {
	it('shapes audited queries and allocates temporal context within the document bound', async () => {
		const direct = Array.from({ length: 45 }, (_, index) =>
			item(`direct-${index.toString().padStart(2, '0')}`)
		)
		const findExactDocumentIds = vi.fn(() => succeed(['exact']))
		const retrieve = vi.fn(() =>
			succeed(
				retrievalResult(direct, [
					'exact',
					...direct.slice(0, 39).map(({ fragment }) => fragment.documentId)
				])
			)
		)
		const getContext = vi.fn(() =>
			succeed({
				scope: 'neighborhood' as const,
				events: [
					{ documentId: 'temporal-b', title: 'Temporal B' },
					{ documentId: 'temporal-a', title: 'Temporal A' }
				],
				edges: [],
				containments: []
			})
		)
		const hydrateDocuments = vi.fn(() => succeed([]))
		const policy = ingestionContext({
			candidates: { findExactDocumentIds, retrieve },
			timeline: { getContext },
			hydrateDocuments
		})

		await runPromise(policy.retrieveDocuments('campaign', [claim]))

		expect(findExactDocumentIds).toHaveBeenCalledWith('campaign', ['Western gate opened', 'Varek'])
		const retrievalInput = retrieve.mock.calls[0]![0]
		expect(retrievalInput.lexicalQuery).toBe(
			'Varek opened the western gate.\nWestern gate opened\nVarek'
		)
		expect(retrievalInput.semanticQuery).toBe(retrievalInput.lexicalQuery)
		expect(retrievalInput.lexicalQuery).not.toContain('Unaudited transcript-only chatter')
		expect(retrievalInput.graph).toMatchObject({ queryLimit: 80, resultLimit: 80 })
		const selectedSeeds = retrievalInput.graph!.selectSeedDocumentIds({
			exactDocumentIds: ['exact'],
			exactCandidates: [],
			lexicalCandidates: [],
			semanticCandidates: [],
			rankedCandidates: direct
		} satisfies DirectCandidateResult)
		expect(selectedSeeds).toEqual([
			'exact',
			...direct.slice(0, 39).map(({ fragment }) => fragment.documentId)
		])
		expect(getContext).toHaveBeenCalledWith(
			'campaign',
			['exact', ...direct.slice(0, 39).map(({ fragment }) => fragment.documentId)],
			{ maxDepth: 2, maxEvents: 80, maxEdges: 120 }
		)
		const hydratedIds = hydrateDocuments.mock.calls[0]![1]
		expect(hydratedIds).toHaveLength(MAX_INGESTION_ANALYSIS_DOCUMENTS)
		expect(hydratedIds).toEqual([
			'exact',
			...direct.slice(0, 38).map(({ fragment }) => fragment.documentId),
			'temporal-a'
		])
	})

	it('fails before discovery when exact matches exceed the bound', async () => {
		const exactDocumentIds = Array.from(
			{ length: MAX_INGESTION_ANALYSIS_DOCUMENTS + 1 },
			(_, index) => `exact-${index}`
		)
		const findExactDocumentIds = vi.fn(() => succeed(exactDocumentIds))
		const retrieve = vi.fn()
		const hydrateDocuments = vi.fn()
		const policy = ingestionContext({
			candidates: { findExactDocumentIds, retrieve },
			timeline: { getContext: vi.fn() },
			hydrateDocuments
		})

		const failure = await runPromise(flip(policy.retrieveDocuments('campaign', [claim])))

		expect(failure).toMatchObject({
			domain: 'ingestion',
			operation: 'retrieveAnalysisContext',
			cause: {
				reason: 'exactMatchesExceedLimit',
				exactMatches: 41,
				maxDocuments: 40
			}
		})
		expect(retrieve).not.toHaveBeenCalled()
		expect(hydrateDocuments).not.toHaveBeenCalled()
	})

	it('hydrates exact IDs directly when they fill the bound', async () => {
		const exactDocumentIds = Array.from(
			{ length: MAX_INGESTION_ANALYSIS_DOCUMENTS },
			(_, index) => `exact-${index}`
		)
		const retrieve = vi.fn()
		const getContext = vi.fn()
		const hydrateDocuments = vi.fn(() => succeed([]))
		const policy = ingestionContext({
			candidates: {
				findExactDocumentIds: () => succeed(exactDocumentIds),
				retrieve
			},
			timeline: { getContext },
			hydrateDocuments
		})

		await runPromise(policy.retrieveDocuments('campaign', [claim]))

		expect(hydrateDocuments).toHaveBeenCalledWith('campaign', exactDocumentIds)
		expect(retrieve).not.toHaveBeenCalled()
		expect(getContext).not.toHaveBeenCalled()
	})
})
