import { fail as failEffect, succeed, type Effect } from 'effect/Effect'
import type { Failure } from '../../failure.js'
import { temporalGraphProblem } from '../../timeline/graph.js'
import type { TimelineContainment, TimelineEdge } from '../../timeline/types.js'
import type { VaultDocument } from '../../vault/types.js'
import { existingTimelineContainments, existingTimelineEdges } from '../chronology.js'
import { commitMutationId, ingestionDocumentId } from '../ids.js'
import type { MutationPlan, PlannedMutation } from '../internal.js'
import type { SessionChronologyProposal, SessionProposal } from '../types.js'
import { categoryDirectory, toSlug } from '../text.js'

export const documentIdsFor = (ingestionId: string, proposals: SessionProposal[]) =>
	Object.fromEntries(
		proposals.map((proposal) => [
			proposal.proposalId,
			proposal.operation === 'update-canon' && proposal.base
				? proposal.base.documentId
				: ingestionDocumentId(ingestionId, proposal.proposalId)
		])
	)

export const planMutations = (
	ingestionId: string,
	resolvedSelected: SessionProposal[],
	selectedChronology: SessionChronologyProposal[],
	sessionProposal: SessionProposal | undefined,
	documents: VaultDocument[]
): Effect<MutationPlan, Failure> => {
	const documentIdByProposal = documentIdsFor(ingestionId, resolvedSelected)
	const existingById = Object.fromEntries(documents.map((document) => [document.id, document]))
	const proposalById = new Map(resolvedSelected.map((proposal) => [proposal.proposalId, proposal]))
	const documentIdForEndpoint = (endpoint: SessionChronologyProposal['source']) => {
		if (endpoint.source === 'proposal') {
			const proposal = proposalById.get(endpoint.eventId)
			return proposal?.documentType === 'event' ? documentIdByProposal[endpoint.eventId] : undefined
		}
		const document = existingById[endpoint.eventId]
		return document?.type === 'event' ? document.id : undefined
	}
	const chronologyEdges: TimelineEdge[] = []
	const chronologyContainments: TimelineContainment[] = []
	for (const relation of selectedChronology) {
		const sourceDocumentId = documentIdForEndpoint(relation.source)
		const targetDocumentId = documentIdForEndpoint(relation.target)
		if (!sourceDocumentId) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: {
					reason: 'staleChronologyEndpoint',
					chronologyId: relation.chronologyId,
					endpoint: { role: 'source', ...relation.source }
				}
			} satisfies Failure)
		}
		if (!targetDocumentId) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: {
					reason: 'staleChronologyEndpoint',
					chronologyId: relation.chronologyId,
					endpoint: { role: 'target', ...relation.target }
				}
			} satisfies Failure)
		}
		if (relation.relation === 'before') {
			chronologyEdges.push({
				beforeDocumentId: sourceDocumentId,
				afterDocumentId: targetDocumentId
			})
		} else {
			chronologyContainments.push({
				eventDocumentId: sourceDocumentId,
				periodDocumentId: targetDocumentId
			})
		}
	}
	const chronologyProblem = temporalGraphProblem(
		[...existingTimelineEdges(documents), ...chronologyEdges],
		[...existingTimelineContainments(documents), ...chronologyContainments]
	)
	if (chronologyProblem) {
		return failEffect({
			domain: 'ingestion',
			operation: 'commit',
			cause: { reason: 'invalidChronology', problem: chronologyProblem }
		} satisfies Failure)
	}
	const predecessorsByDocumentId = new Map<string, string[]>()
	for (const { beforeDocumentId, afterDocumentId } of chronologyEdges) {
		const predecessors = predecessorsByDocumentId.get(afterDocumentId) ?? []
		predecessors.push(beforeDocumentId)
		predecessorsByDocumentId.set(afterDocumentId, predecessors)
	}
	const periodsByDocumentId = new Map<string, string[]>()
	const periodDocumentIds = new Set<string>()
	for (const { eventDocumentId, periodDocumentId } of chronologyContainments) {
		const periods = periodsByDocumentId.get(eventDocumentId) ?? []
		periods.push(periodDocumentId)
		periodsByDocumentId.set(eventDocumentId, periods)
		periodDocumentIds.add(periodDocumentId)
	}
	const updatedDocumentIds = resolvedSelected
		.filter(({ operation }) => operation === 'update-canon')
		.map((proposal) => documentIdByProposal[proposal.proposalId]!)
	if (new Set(updatedDocumentIds).size !== updatedDocumentIds.length) {
		return failEffect({
			domain: 'ingestion',
			operation: 'commit',
			cause: { reason: 'duplicateDocumentMutation' }
		} satisfies Failure)
	}

	const planned: PlannedMutation[] = []
	const createPaths = new Set(documents.map(({ path }) => path))
	const nextCreatePath = (proposal: SessionProposal) => {
		const directory = categoryDirectory[proposal.documentType]
		const slug = toSlug(proposal.title)
		let suffix = 1
		let path = `${directory}/${slug}.md`
		while (createPaths.has(path)) {
			suffix += 1
			path = `${directory}/${slug}-${suffix}.md`
		}
		createPaths.add(path)
		return path
	}
	for (const proposal of resolvedSelected) {
		if (proposal.operation === 'record-only') continue
		const documentId = documentIdByProposal[proposal.proposalId]!
		if (proposal.operation === 'update-canon') {
			const existing = existingById[documentId]
			if (!existing || !proposal.base || !proposal.patch) {
				return failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'missingUpdateBase', proposalId: proposal.proposalId }
				} satisfies Failure)
			}
			const addedPredecessors = predecessorsByDocumentId.get(documentId) ?? []
			const addedPeriods = periodsByDocumentId.get(documentId) ?? []
			planned.push({
				mutationId: commitMutationId(ingestionId, 'update', documentId, proposal.proposalId),
				proposal,
				documentId,
				after: [...new Set([...existing.after, ...addedPredecessors])],
				during: [...new Set([...existing.during, ...addedPeriods])],
				eventForm:
					existing.type === 'event'
						? periodDocumentIds.has(documentId) || proposal.eventForm === 'period'
							? 'period'
							: (existing.eventForm ?? 'occurrence')
						: undefined
			})
			continue
		}

		const after = [...new Set(predecessorsByDocumentId.get(documentId) ?? [])]
		const during = [...new Set(periodsByDocumentId.get(documentId) ?? [])]
		const path = nextCreatePath(proposal)
		planned.push({
			mutationId: commitMutationId(ingestionId, 'create', documentId, proposal.proposalId),
			proposal,
			documentId,
			path,
			after,
			during,
			eventForm:
				proposal.documentType === 'event'
					? periodDocumentIds.has(documentId) || proposal.eventForm === 'period'
						? 'period'
						: (proposal.eventForm ?? 'occurrence')
					: undefined
		})
	}
	const updatedDocumentIdSet = new Set(updatedDocumentIds)
	const createdDocumentIds = new Set(
		planned
			.filter(({ proposal }) => proposal.operation !== 'update-canon')
			.map(({ documentId }) => documentId)
	)
	const chronologyUpdates: MutationPlan['chronologyUpdates'] = []
	const chronologyUpdateIds = new Set([
		...predecessorsByDocumentId.keys(),
		...periodsByDocumentId.keys(),
		...periodDocumentIds
	])
	for (const documentId of chronologyUpdateIds) {
		if (createdDocumentIds.has(documentId) || updatedDocumentIdSet.has(documentId)) continue
		const existing = existingById[documentId]
		if (!existing || existing.type !== 'event' || !existing.currentRevisionId) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'missingChronologyBase', documentId }
			} satisfies Failure)
		}
		const addedPredecessors = predecessorsByDocumentId.get(documentId) ?? []
		const addedPeriods = periodsByDocumentId.get(documentId) ?? []
		chronologyUpdates.push({
			mutationId: commitMutationId(ingestionId, 'chronology', documentId),
			documentId,
			after: [...new Set([...existing.after, ...addedPredecessors])],
			during: [...new Set([...existing.during, ...addedPeriods])],
			eventForm: periodDocumentIds.has(documentId) ? 'period' : (existing.eventForm ?? 'occurrence')
		})
	}

	return succeed({
		planned,
		chronologyUpdates,
		documentIdByProposal,
		existingById,
		sessionDocumentId: sessionProposal
			? documentIdByProposal[sessionProposal.proposalId]
			: undefined
	})
}
