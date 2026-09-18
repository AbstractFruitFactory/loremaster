import { gen, type Effect } from 'effect/Effect'
import type { candidateRetrieval, DirectCandidateResult } from '../context/candidates.js'
import type { ContextItem } from '../context/types.js'
import { fail, type Failure } from '../failure.js'
import type { timeline as createTimeline } from '../timeline/index.js'
import type { VaultDocument } from '../vault/types.js'
import type { SessionValidatedClaim } from './types.js'

export const MAX_INGESTION_ANALYSIS_DOCUMENTS = 40
export const INGESTION_GRAPH_LIMIT_MULTIPLIER = 2
export const INGESTION_TIMELINE_DEPTH = 2
export const INGESTION_TIMELINE_EVENT_LIMIT_MULTIPLIER = 2
export const INGESTION_TIMELINE_EDGE_LIMIT_MULTIPLIER = 3
const MAX_INGESTION_ANALYSIS_QUERY_CHARACTERS = 12_000
const MAX_INGESTION_ANALYSIS_QUERY_VALUE_CHARACTERS = 500

const uniqueDocumentIds = (candidates: ContextItem[]) => [
	...new Set(candidates.map(({ fragment }) => fragment.documentId))
]

const queryInputFor = (claims: SessionValidatedClaim[]) => {
	const normalizeQueryValue = (value: string) =>
		value.replace(/\s+/g, ' ').trim().slice(0, MAX_INGESTION_ANALYSIS_QUERY_VALUE_CHARACTERS)
	const queryValues = [
		...new Set(
			claims
				.flatMap(({ content, eventTitle, entityReferences }) => [
					content,
					...(eventTitle ? [eventTitle] : []),
					...entityReferences.map(({ label }) => label)
				])
				.map(normalizeQueryValue)
				.filter(Boolean)
		)
	]
	const exactNames = [
		...new Set(
			claims
				.flatMap(({ eventTitle, entityReferences }) => [
					...(eventTitle ? [eventTitle] : []),
					...entityReferences.map(({ label }) => label)
				])
				.map(normalizeQueryValue)
				.filter(Boolean)
		)
	]

	return {
		exactNames,
		query: queryValues.join('\n').slice(0, MAX_INGESTION_ANALYSIS_QUERY_CHARACTERS)
	}
}

export const ingestionContext = ({
	candidates,
	timeline,
	hydrateDocuments
}: {
	candidates: Pick<ReturnType<typeof candidateRetrieval>, 'findExactDocumentIds' | 'retrieve'>
	timeline: Pick<ReturnType<typeof createTimeline>, 'getContext'>
	hydrateDocuments: (campaignId: string, documentIds: string[]) => Effect<VaultDocument[], Failure>
}) => {
	const retrieveDocuments = (campaignId: string, claims: SessionValidatedClaim[]) =>
		gen(function* () {
			const { exactNames, query } = queryInputFor(claims)
			const exactDocumentIds = yield* candidates.findExactDocumentIds(campaignId, exactNames)
			if (exactDocumentIds.length > MAX_INGESTION_ANALYSIS_DOCUMENTS) {
				return yield* fail('ingestion', 'retrieveAnalysisContext', {
					reason: 'exactMatchesExceedLimit',
					exactMatches: exactDocumentIds.length,
					maxDocuments: MAX_INGESTION_ANALYSIS_DOCUMENTS
				})
			}
			if (exactDocumentIds.length === MAX_INGESTION_ANALYSIS_DOCUMENTS) {
				return yield* hydrateDocuments(campaignId, exactDocumentIds)
			}

			const result = yield* candidates.retrieve({
				campaignId,
				exactDocumentIds,
				...(query ? { lexicalQuery: query, semanticQuery: query } : {}),
				graph: {
					selectSeedDocumentIds: (direct: DirectCandidateResult) => {
						const supplementalIds = uniqueDocumentIds(direct.rankedCandidates).filter(
							(documentId) => !exactDocumentIds.includes(documentId)
						)
						return [
							...exactDocumentIds,
							...supplementalIds.slice(
								0,
								MAX_INGESTION_ANALYSIS_DOCUMENTS - exactDocumentIds.length
							)
						]
					},
					queryLimit: MAX_INGESTION_ANALYSIS_DOCUMENTS * INGESTION_GRAPH_LIMIT_MULTIPLIER,
					resultLimit: MAX_INGESTION_ANALYSIS_DOCUMENTS * INGESTION_GRAPH_LIMIT_MULTIPLIER
				}
			})
			const graphSeedDocumentIdSet = new Set(result.graphSeedDocumentIds)
			const temporalDocumentIds = result.graphSeedDocumentIds.length
				? (yield* timeline.getContext(campaignId, result.graphSeedDocumentIds, {
						maxDepth: INGESTION_TIMELINE_DEPTH,
						maxEvents: MAX_INGESTION_ANALYSIS_DOCUMENTS * INGESTION_TIMELINE_EVENT_LIMIT_MULTIPLIER,
						maxEdges: MAX_INGESTION_ANALYSIS_DOCUMENTS * INGESTION_TIMELINE_EDGE_LIMIT_MULTIPLIER
					})).events
						.map(({ documentId }) => documentId)
						.filter((documentId) => !graphSeedDocumentIdSet.has(documentId))
						.sort((left, right) => left.localeCompare(right))
				: []
			const supplementalDocumentIds = uniqueDocumentIds(result.rankedDirectCandidates).filter(
				(documentId) => !exactDocumentIds.includes(documentId)
			)
			const graphDocumentIds = uniqueDocumentIds(result.rankedGraphCandidates)
			const selectedDocumentIds = [...exactDocumentIds]
			const selected = new Set(selectedDocumentIds)
			const addDocumentIds = (documentIds: string[], limit = Number.POSITIVE_INFINITY) => {
				let added = 0
				for (const documentId of documentIds) {
					if (
						selected.size >= MAX_INGESTION_ANALYSIS_DOCUMENTS ||
						selected.has(documentId) ||
						added >= limit
					) {
						continue
					}
					selected.add(documentId)
					selectedDocumentIds.push(documentId)
					added += 1
				}
			}
			const remaining = MAX_INGESTION_ANALYSIS_DOCUMENTS - selected.size
			const directLimit =
				temporalDocumentIds.length && supplementalDocumentIds.length && remaining > 1
					? remaining - 1
					: remaining

			addDocumentIds(supplementalDocumentIds, directLimit)
			addDocumentIds(temporalDocumentIds)
			addDocumentIds(graphDocumentIds)
			addDocumentIds(supplementalDocumentIds)

			return yield* hydrateDocuments(campaignId, selectedDocumentIds)
		})

	return { retrieveDocuments }
}
