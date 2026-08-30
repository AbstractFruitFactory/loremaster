import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { EMBEDDING_MODEL } from '../ai/embeddings'
import type { LexicalFragmentMatch } from '../db/context'
import type { LinkedDocument } from '../db/vault'
import { contextOperations } from './operations'
import type { ContextSource, SemanticSearchResult } from './types'

const campaignId = '17ea64a7-98e4-40de-ae5f-b8e35688e157'

const source = (documentId: string, position = 0): ContextSource => ({
	fragment: {
		id: `${documentId}:fragment:${position}`,
		campaignId,
		documentId,
		title: documentId === 'varek' ? 'Varek' : documentId,
		documentType: 'lore',
		content: `${documentId} lore`,
		position,
		contentHash: `${documentId}-hash-${position}`
	},
	...(documentId === 'varek' ? { aliases: ['The Gatekeeper'] } : {})
})

const createContext = ({
	sources = [source('varek'), source('mara'), source('archive'), source('moonblade')],
	lexicalMatches = [],
	semanticResults = [],
	outgoingLinks = [],
	backlinks = [],
	queryVector = [1]
}: {
	sources?: ContextSource[]
	lexicalMatches?: LexicalFragmentMatch[]
	semanticResults?: SemanticSearchResult[]
	outgoingLinks?: LinkedDocument[]
	backlinks?: LinkedDocument[]
	queryVector?: number[]
} = {}) => {
	const db = {
		findDocumentIdsByNames: vi.fn((_campaignId: string, normalizedNames: string[]) =>
			succeed(normalizedNames.includes('varek') ? ['varek'] : [])
		),
		getBacklinksForDocuments: vi.fn(() => succeed(backlinks)),
		getFragmentsByIds: vi.fn((_campaignId: string, fragmentIds: string[]) => {
			const sourcesById = new Map(sources.map((item) => [item.fragment.id, item]))
			return succeed(
				fragmentIds.flatMap((fragmentId) => {
					const item = sourcesById.get(fragmentId)
					return item ? [item] : []
				})
			)
		}),
		getFragmentsForDocuments: vi.fn((_campaignId: string, documentIds: string[]) =>
			succeed(sources.filter(({ fragment }) => documentIds.includes(fragment.documentId)))
		),
		getOutgoingLinksForDocuments: vi.fn(() => succeed(outgoingLinks)),
		searchLexicalFragments: vi.fn(() => succeed(lexicalMatches)),
		searchVectors: vi.fn(() => succeed(semanticResults))
	}
	const ai = {
		embedTexts: vi.fn(() => succeed([queryVector])),
		model: EMBEDDING_MODEL
	}

	return { ai, context: contextOperations({ ai, db }), db }
}

describe('context operations', () => {
	it('retrieves, expands, merges, ranks, and budgets persisted context', async () => {
		const varek = source('varek')
		const { context, db } = createContext({
			lexicalMatches: [{ source: varek, score: 6 }],
			semanticResults: [{ fragmentId: 'moonblade:fragment:0', score: 0.8 }],
			outgoingLinks: [{ seedDocumentId: 'varek', documentId: 'mara' }],
			backlinks: [{ seedDocumentId: 'moonblade', documentId: 'archive' }]
		})

		const result = await runPromise(
			context.buildAssistantContext({
				campaignId,
				message: 'What does Varek know?',
				history: []
			})
		)

		expect(db.getOutgoingLinksForDocuments).toHaveBeenCalledWith(campaignId, ['varek', 'moonblade'])
		expect(result.items.find(({ fragment }) => fragment.documentId === 'varek')?.reasons).toEqual([
			'direct-mention',
			'lexical-match'
		])
		expect(
			result.items.find(({ fragment }) => fragment.documentId === 'moonblade')?.reasons
		).toEqual(['semantic-match'])
		expect(result.items.find(({ fragment }) => fragment.documentId === 'mara')?.reasons).toEqual([
			'wiki-link'
		])
		expect(result.items.find(({ fragment }) => fragment.documentId === 'archive')?.reasons).toEqual(
			['backlink']
		)
	})

	it('keeps multiple persisted fragments from a directly mentioned document', async () => {
		const { context } = createContext({
			sources: [source('varek', 0), source('varek', 1)]
		})

		const result = await runPromise(
			context.buildAssistantContext({
				campaignId,
				message: 'Tell me about Varek',
				history: []
			})
		)

		expect(result.items).toHaveLength(2)
		expect(new Set(result.items.map(({ fragment }) => fragment.id)).size).toBe(2)
	})

	it('normalizes lexical terms before querying Postgres', async () => {
		const { context, db } = createContext({
			lexicalMatches: [{ source: source('mara'), score: 5 }]
		})

		await runPromise(
			context.buildAssistantContext({
				campaignId,
				message: 'Where is the silver sword?',
				history: []
			})
		)

		expect(db.searchLexicalFragments).toHaveBeenCalledWith(campaignId, ['silver', 'sword'])
	})

	it('hydrates semantic matches, drops stale vectors, and isolates the embedding model', async () => {
		const { context, db } = createContext({
			semanticResults: [
				{ fragmentId: 'varek:fragment:0', score: 0.8 },
				{ fragmentId: 'stale', score: 1 }
			]
		})

		const result = await runPromise(
			context.buildAssistantContext({
				campaignId,
				message: 'Who keeps watch?',
				history: []
			})
		)

		expect(db.getFragmentsByIds).toHaveBeenCalledWith(campaignId, ['varek:fragment:0', 'stale'])
		expect(db.searchVectors).toHaveBeenCalledWith(campaignId, [1], 10, 0.1, EMBEDDING_MODEL)
		expect(result.items).toMatchObject([
			{ fragment: { documentId: 'varek' }, score: 48, reasons: ['semantic-match'] }
		])
	})

	it('does not query vectors for a zero query embedding', async () => {
		const { context, db } = createContext({ queryVector: [0, 0] })

		await runPromise(
			context.buildAssistantContext({
				campaignId,
				message: '   ',
				history: []
			})
		)

		expect(db.searchVectors).not.toHaveBeenCalled()
	})
})
