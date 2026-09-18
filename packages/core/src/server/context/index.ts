import { gen, type Effect } from 'effect/Effect'
import type { Failure } from '../failure.js'
import type { timeline as createTimeline } from '../timeline/index.js'
import type { TimelineContext } from '../timeline/types.js'
import { DEFAULT_CONTEXT_TOKEN_BUDGET, selectWithinBudget } from './budget.js'
import type { candidateRetrieval, DirectCandidateResult } from './candidates.js'
import { mentionCandidates } from './mentions.js'
import type { AssistantContext, ContextConversationMessage } from './types.js'

export const STRONG_LEXICAL_SCORE = 5
export const STRONG_SEMANTIC_SCORE = 5
export const DEFAULT_RETRIEVAL_HISTORY_MESSAGES = 6
export const DEFAULT_RETRIEVAL_HISTORY_MESSAGE_CHARACTERS = 2_000

const semanticRetrievalQuery = (message: string, history: ContextConversationMessage[]) => {
	const recentHistory = history
		.slice(-DEFAULT_RETRIEVAL_HISTORY_MESSAGES)
		.map(
			({ role, content }) =>
				`${role === 'user' ? 'Dungeon Master' : 'Loremaster'}: ${content.slice(0, DEFAULT_RETRIEVAL_HISTORY_MESSAGE_CHARACTERS)}`
		)
		.join('\n')

	return recentHistory
		? `## Recent conversation\n${recentHistory}\n\n## Current request\n${message}`
		: message
}

const estimateTimelineTokens = ({ events, edges, containments }: TimelineContext) =>
	Math.ceil(
		(events.reduce((length, event) => length + event.title.length, 0) +
			edges.reduce(
				(length, edge) => length + edge.beforeDocumentId.length + edge.afterDocumentId.length,
				0
			) +
			containments.reduce(
				(length, containment) =>
					length + containment.eventDocumentId.length + containment.periodDocumentId.length,
				0
			)) /
			4
	)

const requestsCampaignChronology = (message: string) =>
	/\b(?:before|after|during|earlier|later|first|next|when|order(?:ed|ing)?|sequence|chronolog(?:y|ical|ically)|timeline|simultaneous(?:ly)?|unordered|unplaced|temporal)\b/i.test(
		message
	)

type ContextDependencies = {
	candidates: Pick<ReturnType<typeof candidateRetrieval>, 'retrieve'>
	timeline: Pick<ReturnType<typeof createTimeline>, 'getCampaignContext' | 'getContext'>
	maxTokens?: number
}

const selectGraphSeedDocumentIds = ({
	exactCandidates,
	lexicalCandidates,
	semanticCandidates
}: DirectCandidateResult) => [
	...new Set([
		...exactCandidates.map(({ fragment }) => fragment.documentId),
		...lexicalCandidates
			.filter(({ score }) => score >= STRONG_LEXICAL_SCORE)
			.map(({ fragment }) => fragment.documentId),
		...semanticCandidates
			.filter(({ score }) => score >= STRONG_SEMANTIC_SCORE)
			.map(({ fragment }) => fragment.documentId)
	])
]

export const context = ({
	candidates,
	timeline,
	maxTokens = DEFAULT_CONTEXT_TOKEN_BUDGET
}: ContextDependencies) => {
	const buildAssistantContext = (input: {
		campaignId: string
		message: string
		history: ContextConversationMessage[]
	}): Effect<AssistantContext, Failure> =>
		gen(function* () {
			const { campaignId, message, history } = input
			const result = yield* candidates.retrieve({
				campaignId,
				exactNames: mentionCandidates(message),
				lexicalQuery: message,
				semanticQuery: semanticRetrievalQuery(message, history),
				graph: { selectSeedDocumentIds: selectGraphSeedDocumentIds }
			})
			const rankedCandidates = result.rankedCandidates
			const timelineContext = requestsCampaignChronology(message)
				? yield* timeline.getCampaignContext(campaignId)
				: yield* timeline.getContext(campaignId, [
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
