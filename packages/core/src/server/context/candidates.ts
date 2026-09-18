import { all, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiModel } from '../ai/provider.js'
import type * as ContextDb from '../db/context.js'
import type * as VaultDb from '../db/vault.js'
import type * as VectorDb from '../db/vector.js'
import { fail, type Failure } from '../failure.js'
import { documentMentionNames } from './mentions.js'
import { rankCandidates, scoreWeights } from './rank.js'
import { extractSearchTerms } from './retrieval/lexical.js'
import { retrieveSemanticMatches } from './retrieval/semantic.js'
import type { ContextCandidate, ContextItem, ContextReason, SemanticSearchResult } from './types.js'

export const DEFAULT_SEMANTIC_RESULTS = 10
export const DEFAULT_SEMANTIC_MIN_SCORE = 0.1

export type DirectCandidateResult = {
	exactDocumentIds: string[]
	exactCandidates: ContextCandidate[]
	lexicalCandidates: ContextCandidate[]
	semanticCandidates: ContextCandidate[]
	rankedCandidates: ContextItem[]
}

export type CandidateRetrievalResult = Omit<DirectCandidateResult, 'rankedCandidates'> & {
	graphSeedDocumentIds: string[]
	graphCandidates: ContextCandidate[]
	rankedDirectCandidates: ContextItem[]
	rankedGraphCandidates: ContextItem[]
	rankedCandidates: ContextItem[]
}

type CandidateRetrievalDependencies = {
	ai: AiModel<'embedTexts'>
	db: {
		getFragmentsByIds: typeof ContextDb.getFragmentsByIds
		getFragmentsForDocuments: typeof ContextDb.getFragmentsForDocuments
		getBacklinksForDocuments: typeof VaultDb.getBacklinksForDocuments
		getIncomingRelationshipLinksForDocuments: typeof VaultDb.getIncomingRelationshipLinksForDocuments
		findDocumentIdsByNames: typeof ContextDb.findDocumentIdsByNames
		getOutgoingLinksForDocuments: typeof VaultDb.getOutgoingLinksForDocuments
		getOutgoingRelationshipLinksForDocuments: typeof VaultDb.getOutgoingRelationshipLinksForDocuments
		searchLexicalFragments: typeof ContextDb.searchLexicalFragments
		searchVectors: typeof VectorDb.searchVectors
	}
}

const isZeroVector = (vector: number[]) => vector.every((value) => value === 0)

export const candidateRetrieval = ({ ai, db }: CandidateRetrievalDependencies) => {
	const findExactDocumentIds = (campaignId: string, exactNames: string[]) => {
		const normalizedNames = [...new Set(exactNames.flatMap((name) => documentMentionNames(name)))]
		return pipe(
			db.findDocumentIdsByNames(campaignId, normalizedNames),
			map((documentIds) =>
				[...new Set(documentIds)].sort((left, right) => left.localeCompare(right))
			)
		)
	}

	const hydrateExactCandidates = (campaignId: string, documentIds: string[]) =>
		pipe(
			db.getFragmentsForDocuments(campaignId, documentIds),
			map((sources): ContextCandidate[] =>
				sources.map(({ fragment }) => ({
					fragment,
					score: 0,
					reasons: ['direct-mention']
				}))
			)
		)

	const searchLexical = (campaignId: string, query?: string) =>
		query === undefined
			? succeed([])
			: pipe(
					db.searchLexicalFragments(campaignId, extractSearchTerms(query)),
					map((matches): ContextCandidate[] =>
						matches.map(({ source, score }) => ({
							fragment: source.fragment,
							score,
							reasons: ['lexical-match']
						}))
					)
				)

	const searchSemanticIndex = (
		campaignId: string,
		queryVector: number[]
	): Effect<SemanticSearchResult[], Failure> =>
		isZeroVector(queryVector)
			? succeed([])
			: db.searchVectors(
					campaignId,
					queryVector,
					DEFAULT_SEMANTIC_RESULTS,
					DEFAULT_SEMANTIC_MIN_SCORE,
					ai.model
				)

	const searchSemantic = (campaignId: string, query?: string) =>
		query === undefined
			? succeed([])
			: gen(function* () {
					const [queryVector] = yield* ai.embedTexts({ model: ai.model, values: [query] })
					const results = queryVector ? yield* searchSemanticIndex(campaignId, queryVector) : []
					const fragmentIds = results.map(({ fragmentId }) => fragmentId)
					const sources = yield* db.getFragmentsByIds(campaignId, fragmentIds)
					return retrieveSemanticMatches(campaignId, results, sources)
				})

	const expandGraph = (
		campaignId: string,
		seedDocumentIds: string[],
		options: { queryLimit?: number; resultLimit?: number }
	) => {
		const { queryLimit, resultLimit } = options
		const outgoingLinks =
			queryLimit === undefined
				? db.getOutgoingLinksForDocuments(campaignId, seedDocumentIds)
				: db.getOutgoingLinksForDocuments(campaignId, seedDocumentIds, queryLimit)
		const backlinks =
			queryLimit === undefined
				? db.getBacklinksForDocuments(campaignId, seedDocumentIds)
				: db.getBacklinksForDocuments(campaignId, seedDocumentIds, queryLimit)
		const relationshipLinks =
			queryLimit === undefined
				? db.getOutgoingRelationshipLinksForDocuments(campaignId, seedDocumentIds)
				: db.getOutgoingRelationshipLinksForDocuments(campaignId, seedDocumentIds, queryLimit)
		const relationshipBacklinks =
			queryLimit === undefined
				? db.getIncomingRelationshipLinksForDocuments(campaignId, seedDocumentIds)
				: db.getIncomingRelationshipLinksForDocuments(campaignId, seedDocumentIds, queryLimit)
		return pipe(
			all([outgoingLinks, backlinks, relationshipLinks, relationshipBacklinks]),
			flatMap(([outgoingLinks, backlinks, relationshipLinks, relationshipBacklinks]) => {
				const reasonsByDocumentId = new Map<string, Set<ContextReason>>()
				const addReason = (links: VaultDb.LinkedDocument[], reason: ContextReason) => {
					for (const { seedDocumentId, documentId } of links) {
						if (documentId === seedDocumentId) continue
						const reasons = reasonsByDocumentId.get(documentId) ?? new Set()
						reasons.add(reason)
						reasonsByDocumentId.set(documentId, reasons)
					}
				}

				addReason(relationshipLinks, 'relationship-link')
				addReason(relationshipBacklinks, 'relationship-backlink')
				addReason(outgoingLinks, 'wiki-link')
				addReason(backlinks, 'backlink')

				const rankedDocumentIds = [...reasonsByDocumentId.keys()].sort((left, right) => {
					const score = (documentId: string) =>
						[...(reasonsByDocumentId.get(documentId) ?? [])].reduce(
							(total, reason) => total + scoreWeights[reason],
							0
						)
					return score(right) - score(left) || left.localeCompare(right)
				})
				const documentIds =
					resultLimit === undefined ? rankedDocumentIds : rankedDocumentIds.slice(0, resultLimit)

				return pipe(
					db.getFragmentsForDocuments(campaignId, documentIds),
					map((sources): ContextCandidate[] =>
						sources.map(({ fragment }) => ({
							fragment,
							score: 0,
							reasons: [...(reasonsByDocumentId.get(fragment.documentId) ?? [])]
						}))
					)
				)
			})
		)
	}

	const retrieve = (input: {
		campaignId: string
		exactNames?: string[]
		exactDocumentIds?: string[]
		lexicalQuery?: string
		semanticQuery?: string
		graph?: {
			selectSeedDocumentIds: (result: DirectCandidateResult) => string[]
			queryLimit?: number
			resultLimit?: number
		}
	}): Effect<CandidateRetrievalResult, Failure> =>
		gen(function* () {
			const { campaignId, exactNames = [], lexicalQuery, semanticQuery, graph } = input
			if (
				graph &&
				((graph.queryLimit !== undefined &&
					(!Number.isSafeInteger(graph.queryLimit) || graph.queryLimit < 0)) ||
					(graph.resultLimit !== undefined &&
						(!Number.isSafeInteger(graph.resultLimit) || graph.resultLimit < 0)))
			) {
				return yield* fail('contextCandidates', 'retrieve', { reason: 'invalidGraphLimit' })
			}
			const exactDocumentIds = input.exactDocumentIds
				? [...new Set(input.exactDocumentIds)].sort((left, right) => left.localeCompare(right))
				: yield* findExactDocumentIds(campaignId, exactNames)
			const [exactCandidates, lexicalCandidates, semanticCandidates] = yield* all(
				[
					hydrateExactCandidates(campaignId, exactDocumentIds),
					searchLexical(campaignId, lexicalQuery),
					searchSemantic(campaignId, semanticQuery)
				],
				{ concurrency: 'unbounded' }
			)
			const directResult: DirectCandidateResult = {
				exactDocumentIds,
				exactCandidates,
				lexicalCandidates,
				semanticCandidates,
				rankedCandidates: rankCandidates([
					...exactCandidates,
					...lexicalCandidates,
					...semanticCandidates
				])
			}
			const graphSeedDocumentIds = graph
				? [...new Set(graph.selectSeedDocumentIds(directResult))]
				: []
			const graphCandidates =
				graph && graphSeedDocumentIds.length
					? yield* expandGraph(campaignId, graphSeedDocumentIds, graph)
					: []
			const rankedGraphCandidates = rankCandidates(graphCandidates)

			return {
				exactDocumentIds,
				exactCandidates,
				lexicalCandidates,
				semanticCandidates,
				graphSeedDocumentIds,
				graphCandidates,
				rankedDirectCandidates: directResult.rankedCandidates,
				rankedGraphCandidates,
				rankedCandidates: rankCandidates([
					...exactCandidates,
					...lexicalCandidates,
					...semanticCandidates,
					...graphCandidates
				])
			}
		})

	return { findExactDocumentIds, retrieve }
}
