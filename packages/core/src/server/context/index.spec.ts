import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateRetrievalResult, DirectCandidateResult } from './candidates.js'
import { context } from './index.js'
import type { ContextCandidate, ContextItem } from './types.js'

const candidate = (
	documentId: string,
	score: number,
	reasons: ContextCandidate['reasons'],
	documentType: ContextCandidate['fragment']['documentType'] = 'worldbuilding'
): ContextCandidate => ({
	fragment: {
		id: `${documentId}:0`,
		campaignId: 'campaign',
		documentId,
		title: documentId,
		documentType,
		content: `${documentId} lore`,
		position: 0,
		contentHash: `${documentId}:hash`
	},
	score,
	reasons
})

const resultWith = (rankedCandidates: ContextItem[]): CandidateRetrievalResult => ({
	exactDocumentIds: [],
	exactCandidates: [],
	lexicalCandidates: [],
	semanticCandidates: [],
	graphSeedDocumentIds: [],
	graphCandidates: [],
	rankedDirectCandidates: rankedCandidates,
	rankedGraphCandidates: [],
	rankedCandidates
})

describe('chat context policy', () => {
	it('shapes query channels and preserves graph seed thresholds', async () => {
		const event = { ...candidate('event', 100, ['lexical-match'], 'event'), score: 150 }
		const retrieve = vi.fn(() => succeed(resultWith([event])))
		const getContext = vi.fn(() =>
			succeed({ scope: 'neighborhood' as const, events: [], edges: [], containments: [] })
		)
		const operations = context({
			candidates: { retrieve },
			timeline: {
				getContext,
				getCampaignContext: vi.fn()
			}
		})

		await runPromise(
			operations.buildAssistantContext({
				campaignId: 'campaign',
				message: 'What does Varek know?',
				history: [
					{ role: 'user', content: 'Who guards the gate?' },
					{ role: 'assistant', content: 'The records are incomplete.' }
				]
			})
		)

		const input = retrieve.mock.calls[0]![0]
		expect(input.lexicalQuery).toBe('What does Varek know?')
		expect(input.semanticQuery).toBe(
			'## Recent conversation\nDungeon Master: Who guards the gate?\nLoremaster: The records are incomplete.\n\n## Current request\nWhat does Varek know?'
		)
		expect(input.exactNames).toEqual(expect.arrayContaining(['varek', 'what does varek know']))
		const direct: DirectCandidateResult = {
			exactDocumentIds: ['exact'],
			exactCandidates: [candidate('exact', 0, ['direct-mention'])],
			lexicalCandidates: [
				candidate('lexical-strong', 5, ['lexical-match']),
				candidate('lexical-weak', 4, ['lexical-match'])
			],
			semanticCandidates: [
				candidate('semantic-strong', 5, ['semantic-match']),
				candidate('semantic-weak', 4, ['semantic-match'])
			],
			rankedCandidates: []
		}
		expect(input.graph!.selectSeedDocumentIds(direct)).toEqual([
			'exact',
			'lexical-strong',
			'semantic-strong'
		])
		expect(getContext).toHaveBeenCalledWith('campaign', ['event'])
	})

	it('keeps campaign chronology policy outside candidate retrieval', async () => {
		const retrieve = vi.fn(() => succeed(resultWith([])))
		const getContext = vi.fn()
		const getCampaignContext = vi.fn(() =>
			succeed({ scope: 'campaign' as const, events: [], edges: [], containments: [] })
		)
		const operations = context({
			candidates: { retrieve },
			timeline: { getContext, getCampaignContext }
		})

		await runPromise(
			operations.buildAssistantContext({
				campaignId: 'campaign',
				message: 'Show the complete chronology.',
				history: []
			})
		)

		expect(getCampaignContext).toHaveBeenCalledWith('campaign')
		expect(getContext).not.toHaveBeenCalled()
	})

	it('applies the chat token budget after candidate retrieval', async () => {
		const ranked = ['first', 'second'].map((documentId, index) => ({
			...candidate(documentId, 100 - index, ['direct-mention']),
			score: 200 - index,
			fragment: {
				...candidate(documentId, 100 - index, ['direct-mention']).fragment,
				content: 'x'.repeat(100)
			}
		}))
		const operations = context({
			candidates: { retrieve: () => succeed(resultWith(ranked)) },
			timeline: {
				getContext: () =>
					succeed({ scope: 'neighborhood' as const, events: [], edges: [], containments: [] }),
				getCampaignContext: vi.fn()
			},
			maxTokens: 1
		})

		const result = await runPromise(
			operations.buildAssistantContext({
				campaignId: 'campaign',
				message: 'Tell me about the large record.',
				history: []
			})
		)

		expect(result.items.map(({ fragment }) => fragment.documentId)).toEqual(['first'])
		expect(result.estimatedTokens).toBe(25)
	})
})
