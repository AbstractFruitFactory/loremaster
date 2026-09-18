import { randomUUID } from 'node:crypto'
import { map, succeed } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiProvider } from '../ai/provider.js'
import { temporalGraphProblem, temporalRelation, timelineRelation } from '../timeline/graph.js'
import type { TimelineContainment, TimelineEdge } from '../timeline/types.js'
import type { VaultDocument } from '../vault/types.js'
import { chronologyPrompt, chronologySystem } from './prompts.js'
import type {
	InferredSessionChronology,
	SessionChronologyCoverageProposal,
	SessionChronologyProposal,
	SessionProposal
} from './types.js'

export const existingTimelineEdges = (documents: VaultDocument[]): TimelineEdge[] => {
	const eventIds = new Set(documents.filter(({ type }) => type === 'event').map(({ id }) => id))
	return documents.flatMap((document) =>
		document.type === 'event'
			? document.after
					.filter((beforeDocumentId) => eventIds.has(beforeDocumentId))
					.map((beforeDocumentId) => ({
						beforeDocumentId,
						afterDocumentId: document.id
					}))
			: []
	)
}

export const existingTimelineContainments = (documents: VaultDocument[]): TimelineContainment[] => {
	const eventIds = new Set(documents.filter(({ type }) => type === 'event').map(({ id }) => id))
	return documents.flatMap((document) =>
		document.type === 'event'
			? document.during
					.filter((periodDocumentId) => eventIds.has(periodDocumentId))
					.map((periodDocumentId) => ({
						eventDocumentId: document.id,
						periodDocumentId
					}))
			: []
	)
}

export const chronology = (
	ai: Pick<AiProvider, 'inferSessionChronology'> & { analysisModel: string }
) => {
	const validatedChronology = (
		inference: InferredSessionChronology,
		eventProposals: SessionProposal[],
		existingEvents: VaultDocument[]
	) => {
		const { relations } = inference
		const proposalEvents = new Map(
			eventProposals.map((proposal) => [proposal.proposalId, proposal])
		)
		const existingEventsById = new Map(existingEvents.map((document) => [document.id, document]))
		const eventIds = new Set([...proposalEvents.keys(), ...existingEventsById.keys()])
		const baseEdges = existingTimelineEdges(existingEvents)
		const baseContainments = existingTimelineContainments(existingEvents)
		const accepted: SessionChronologyProposal[] = []
		const acceptedKeys = new Set<string>()
		const warnings: string[] = []

		for (const relation of relations) {
			const key = `${relation.relation}\0${relation.sourceEventId}\0${relation.targetEventId}`
			if (
				!eventIds.has(relation.sourceEventId) ||
				!eventIds.has(relation.targetEventId) ||
				relation.sourceEventId === relation.targetEventId ||
				(!proposalEvents.has(relation.sourceEventId) &&
					!proposalEvents.has(relation.targetEventId)) ||
				acceptedKeys.has(key)
			) {
				warnings.push(
					`Chronology relation discarded [invalid-reference] ${JSON.stringify(relation)}`
				)
				continue
			}

			const endpoint = (eventId: string) => {
				const proposal = proposalEvents.get(eventId)
				if (proposal) return { eventId, title: proposal.title, source: 'proposal' as const }
				const document = existingEventsById.get(eventId)!
				return { eventId, title: document.title, source: 'existing' as const }
			}
			const candidate: SessionChronologyProposal = {
				relation: relation.relation,
				certainty: relation.certainty,
				reason: relation.reason,
				chronologyId: randomUUID(),
				selected: relation.certainty === 'explicit',
				source: endpoint(relation.sourceEventId),
				target: endpoint(relation.targetEventId)
			}
			const edges: TimelineEdge[] = [
				...baseEdges,
				...accepted
					.filter(({ relation }) => relation === 'before')
					.map(({ source, target }) => ({
						beforeDocumentId: source.eventId,
						afterDocumentId: target.eventId
					})),
				...(candidate.relation === 'before'
					? [
							{
								beforeDocumentId: candidate.source.eventId,
								afterDocumentId: candidate.target.eventId
							}
						]
					: [])
			]
			const containments: TimelineContainment[] = [
				...baseContainments,
				...accepted
					.filter(({ relation }) => relation === 'during')
					.map(({ source, target }) => ({
						eventDocumentId: source.eventId,
						periodDocumentId: target.eventId
					})),
				...(candidate.relation === 'during'
					? [
							{
								eventDocumentId: candidate.source.eventId,
								periodDocumentId: candidate.target.eventId
							}
						]
					: [])
			]
			const problem = temporalGraphProblem(edges, containments)
			if (problem) {
				warnings.push(`Chronology relation discarded [${problem}] ${JSON.stringify(relation)}`)
				continue
			}

			accepted.push(candidate)
			acceptedKeys.add(key)
		}

		const direct = accepted.filter((relation) => {
			const otherEdges = [
				...baseEdges,
				...accepted
					.filter(
						({ chronologyId, relation: kind }) =>
							chronologyId !== relation.chronologyId && kind === 'before'
					)
					.map(({ source, target }) => ({
						beforeDocumentId: source.eventId,
						afterDocumentId: target.eventId
					}))
			]
			const otherContainments = [
				...baseContainments,
				...accepted
					.filter(
						({ chronologyId, relation: kind }) =>
							chronologyId !== relation.chronologyId && kind === 'during'
					)
					.map(({ source, target }) => ({
						eventDocumentId: source.eventId,
						periodDocumentId: target.eventId
					}))
			]
			if (relation.relation === 'before') {
				return (
					temporalRelation(
						relation.source.eventId,
						relation.target.eventId,
						otherEdges,
						otherContainments
					) !== 'before'
				)
			}
			return (
				timelineRelation(
					relation.source.eventId,
					relation.target.eventId
				)(
					otherContainments.map(({ eventDocumentId, periodDocumentId }) => ({
						beforeDocumentId: eventDocumentId,
						afterDocumentId: periodDocumentId
					}))
				) !== 'before'
			)
		})

		const coverageByEventId = new Map<string, InferredSessionChronology['coverage'][number]>()
		for (const decision of inference.coverage) {
			if (!proposalEvents.has(decision.eventId) || coverageByEventId.has(decision.eventId)) {
				warnings.push(
					`Chronology coverage discarded [invalid-reference] ${JSON.stringify(decision)}`
				)
				continue
			}
			coverageByEventId.set(decision.eventId, decision)
		}
		const connectedEventIds = new Set(
			direct.flatMap(({ source, target }) => [source.eventId, target.eventId])
		)
		const coverage: SessionChronologyCoverageProposal[] = eventProposals.map((proposal) => {
			const decision = coverageByEventId.get(proposal.proposalId)
			const event = {
				eventId: proposal.proposalId,
				title: proposal.title,
				source: 'proposal' as const
			}
			const connected = connectedEventIds.has(proposal.proposalId)
			if (!decision) {
				warnings.push(
					`Chronology coverage missing for event ${JSON.stringify(proposal.proposalId)}`
				)
				return {
					event,
					status: 'missing',
					reason: 'The chronology model did not account for this event.'
				}
			}
			if (decision.status === 'connected' && !connected) {
				warnings.push(
					`Chronology coverage inconsistent [connected-without-relation] ${JSON.stringify(decision)}`
				)
				return {
					event,
					status: 'missing',
					reason: 'The event was marked connected, but no valid relationship placed it.'
				}
			}
			if (decision.status === 'intentionally-unplaced' && connected) {
				warnings.push(
					`Chronology coverage inconsistent [unplaced-with-relation] ${JSON.stringify(decision)}`
				)
				return { event, status: 'connected', reason: 'A valid chronology relationship places it.' }
			}
			return { event, status: decision.status, reason: decision.reason }
		})

		return { chronology: direct, coverage, warnings }
	}

	const inferChronology = (
		transcript: string,
		eventProposals: SessionProposal[],
		documents: VaultDocument[]
	) => {
		const existingEvents = documents.filter(({ type }) => type === 'event')
		if (!eventProposals.length || eventProposals.length + existingEvents.length < 2) {
			return succeed({
				chronology: [],
				coverage: eventProposals.map((proposal) => ({
					event: {
						eventId: proposal.proposalId,
						title: proposal.title,
						source: 'proposal' as const
					},
					status: 'intentionally-unplaced' as const,
					reason: 'No other event is available to establish a relative placement.'
				})),
				warnings: []
			})
		}
		return pipe(
			ai.inferSessionChronology({
				model: ai.analysisModel,
				system: chronologySystem,
				prompt: chronologyPrompt(transcript, eventProposals, existingEvents)
			}),
			map((inference) => validatedChronology(inference, eventProposals, existingEvents))
		)
	}
	return { inferChronology }
}
