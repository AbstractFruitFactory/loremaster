import { all, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiModel } from '../ai/provider'
import type * as ContextDb from '../db/context'
import type * as VaultDb from '../db/vault'
import type * as VectorDb from '../db/vector'
import type { Failure } from '../failure'
import type { timelineOperations } from '../timeline/operations'
import type { TimelineContext } from '../timeline/types'
import { DEFAULT_CONTEXT_TOKEN_BUDGET, selectWithinBudget } from './budget'
import { mentionCandidates } from './mentions'
import { rankCandidates } from './rank'
import { extractSearchTerms } from './retrieval/lexical'
import { retrieveSemanticMatches } from './retrieval/semantic'
import type {
	AssistantContext,
	ContextCandidate,
	ContextConversationMessage,
	ContextReason,
	SemanticSearchResult
} from './types'

export const STRONG_LEXICAL_SCORE = 5
export const STRONG_SEMANTIC_SCORE = 5
export const DEFAULT_SEMANTIC_RESULTS = 10
export const DEFAULT_SEMANTIC_MIN_SCORE = 0.1

const isZeroVector = (vector: number[]) => vector.every((value) => value === 0)

const estimateTimelineTokens = ({ events, edges }: TimelineContext) =>
	Math.ceil(
		(events.reduce((length, event) => length + event.title.length, 0) +
			edges.reduce(
				(length, edge) => length + edge.beforeDocumentId.length + edge.afterDocumentId.length,
				0
			)) /
			4
	)

type ContextOperationsDependencies = {
	ai: AiModel<'embedTexts'>
	db: {
		getFragmentsByIds: typeof ContextDb.getFragmentsByIds
		getFragmentsForDocuments: typeof ContextDb.getFragmentsForDocuments
		getBacklinksForDocuments: typeof VaultDb.getBacklinksForDocuments
		findDocumentIdsByNames: typeof ContextDb.findDocumentIdsByNames
		getOutgoingLinksForDocuments: typeof VaultDb.getOutgoingLinksForDocuments
		searchLexicalFragments: typeof ContextDb.searchLexicalFragments
		searchVectors: typeof VectorDb.searchVectors
	}
	timeline: Pick<ReturnType<typeof timelineOperations>, 'getContext'>
	maxTokens?: number
}

const selectGraphSeedDocumentIds = (
	directMentions: ContextCandidate[],
	lexicalMatches: ContextCandidate[],
	semanticMatches: ContextCandidate[]
) => [
	...new Set([
		...directMentions.map(({ fragment }) => fragment.documentId),
		...lexicalMatches
			.filter(({ score }) => score >= STRONG_LEXICAL_SCORE)
			.map(({ fragment }) => fragment.documentId),
		...semanticMatches
			.filter(({ score }) => score >= STRONG_SEMANTIC_SCORE)
			.map(({ fragment }) => fragment.documentId)
	])
]

export const contextOperations = ({
	ai,
	db,
	timeline,
	maxTokens = DEFAULT_CONTEXT_TOKEN_BUDGET
}: ContextOperationsDependencies) => {
	const findDirectMentions = (campaignId: string, message: string) =>
		gen(function* () {
			const documentIds = yield* db.findDocumentIdsByNames(campaignId, mentionCandidates(message))
			const sources = yield* db.getFragmentsForDocuments(campaignId, documentIds)

			return sources.map(({ fragment }): ContextCandidate => ({
				fragment,
				score: 0,
				reasons: ['direct-mention']
			}))
		})

	const searchLexical = (campaignId: string, message: string) =>
		pipe(
			db.searchLexicalFragments(campaignId, extractSearchTerms(message)),
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

	const searchSemantic = (campaignId: string, message: string) =>
		gen(function* () {
			const [queryVector] = yield* ai.embedTexts({ model: ai.model, values: [message] })
			const results = queryVector ? yield* searchSemanticIndex(campaignId, queryVector) : []
			const fragmentIds = results.map(({ fragmentId }) => fragmentId)
			const sources = yield* db.getFragmentsByIds(campaignId, fragmentIds)

			return retrieveSemanticMatches(campaignId, results, sources)
		})

	const expandGraph = (campaignId: string, seedDocumentIds: string[]) =>
		pipe(
			all([
				db.getOutgoingLinksForDocuments(campaignId, seedDocumentIds),
				db.getBacklinksForDocuments(campaignId, seedDocumentIds)
			]),
			flatMap(([outgoingLinks, backlinks]) => {
				const reasonsByDocumentId = new Map<string, Set<ContextReason>>()

				const addReason = (links: VaultDb.LinkedDocument[], reason: ContextReason) => {
					for (const { seedDocumentId, documentId } of links) {
						if (documentId === seedDocumentId) continue

						const reasons = reasonsByDocumentId.get(documentId) ?? new Set()
						reasons.add(reason)
						reasonsByDocumentId.set(documentId, reasons)
					}
				}

				addReason(outgoingLinks, 'wiki-link')
				addReason(backlinks, 'backlink')

				return pipe(
					db.getFragmentsForDocuments(campaignId, [...reasonsByDocumentId.keys()]),
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

	const buildAssistantContext = (input: {
		campaignId: string
		message: string
		history: ContextConversationMessage[]
	}): Effect<AssistantContext, Failure> =>
		gen(function* () {
			const { campaignId, message } = input
			const [directMentions, lexicalMatches, semanticMatches] = yield* all(
				[
					findDirectMentions(campaignId, message),
					searchLexical(campaignId, message),
					searchSemantic(campaignId, message)
				],
				{ concurrency: 'unbounded' }
			)
			const seedDocumentIds = selectGraphSeedDocumentIds(
				directMentions,
				lexicalMatches,
				semanticMatches
			)
			const graphCandidates = yield* expandGraph(campaignId, seedDocumentIds)
			const rankedCandidates = rankCandidates([
				...directMentions,
				...lexicalMatches,
				...semanticMatches,
				...graphCandidates
			])
			const timelineContext = yield* timeline.getContext(campaignId, [
				...new Set(
					rankedCandidates
						.filter(({ fragment }) => fragment.documentType === 'event')
						.map(({ fragment }) => fragment.documentId)
				)
			])
			const timelineTokens = estimateTimelineTokens(timelineContext)
			const selected = selectWithinBudget(rankedCandidates, Math.max(0, maxTokens - timelineTokens))

			return {
				...selected,
				timeline: timelineContext,
				estimatedTokens: selected.estimatedTokens + timelineTokens
			}
		})

	return { buildAssistantContext }
}
