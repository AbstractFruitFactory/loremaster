import { gen, succeed, type Effect } from 'effect/Effect'
import { buildSessionRecap, canonicalDocumentContent } from '../../../ingestion.js'
import type { Failure } from '../../failure.js'
import { topologicalLayers } from '../../timeline/graph.js'
import type { VaultDocument } from '../../vault/types.js'
import { commitRevisionId } from '../ids.js'
import type { CommitInput, MutationPlan } from '../internal.js'
import type { IngestionStorage } from '../storage.js'
import type {
	SessionCommitJournal,
	SessionCommitMutationResult,
	SessionIngestionDraft,
	SessionIngestionResult,
	SessionProposal
} from '../types.js'

export const commitMutationIdsInOrder = (plan: MutationPlan) => {
	const creates = plan.planned.filter(({ proposal }) => proposal.operation !== 'update-canon')
	const updates = plan.planned.filter(({ proposal }) => proposal.operation === 'update-canon')
	const eventCreates = creates.filter(({ proposal }) => proposal.documentType === 'event')
	const eventCreateIds = new Set(eventCreates.map(({ documentId }) => documentId))
	const eventCreateEdges = eventCreates.flatMap(({ documentId, after = [] }) =>
		after
			.filter((beforeDocumentId) => eventCreateIds.has(beforeDocumentId))
			.map((beforeDocumentId) => ({ beforeDocumentId, afterDocumentId: documentId }))
	)
	const eventContainmentDependencies = eventCreates.flatMap(({ documentId, during = [] }) =>
		during
			.filter((periodDocumentId) => eventCreateIds.has(periodDocumentId))
			.map((periodDocumentId) => ({
				beforeDocumentId: periodDocumentId,
				afterDocumentId: documentId
			}))
	)
	const layers =
		topologicalLayers(
			[...eventCreateIds],
			[...eventCreateEdges, ...eventContainmentDependencies]
		) ?? []
	const eventRank = new Map(
		layers.flatMap((layer, index) => layer.map((documentId) => [documentId, index] as const))
	)
	const orderedCreates = [
		...creates.filter(({ proposal }) => proposal.documentType !== 'event'),
		...eventCreates.sort(
			(left, right) =>
				(eventRank.get(left.documentId) ?? 0) - (eventRank.get(right.documentId) ?? 0)
		)
	]
	return [
		...orderedCreates.map(({ mutationId }) => mutationId),
		...updates.map(({ mutationId }) => mutationId),
		...plan.chronologyUpdates.map(({ mutationId }) => mutationId)
	]
}

export const commitApplication = (
	vault: {
		createDocument: (
			campaignId: string,
			input: {
				documentId?: string
				path: string
				type: VaultDocument['type']
				after?: string[]
				during?: string[]
				eventForm?: VaultDocument['eventForm']
				content: string
				ingestionId?: string
				transcript?: string
				revision?: {
					source: 'ingestion'
					relatedSessionId: string
					ingestionId: string
					changeSummary: string
					revisionId: string
				}
			}
		) => Effect<VaultDocument, Failure>
		updateDocument: (
			campaignId: string,
			documentId: string,
			input: {
				type: VaultDocument['type']
				aliases?: string[]
				after?: string[]
				during?: string[]
				eventForm?: VaultDocument['eventForm']
				content: string
				expectedRevisionId: string
				expectedPath?: string
				revision?: {
					source: 'ingestion'
					relatedSessionId: string
					ingestionId: string
					changeSummary: string
					revisionId: string
				}
			}
		) => Effect<VaultDocument, Failure>
	},
	storage: IngestionStorage
) => {
	const revisionFor = (
		mutationId: string,
		proposal: SessionProposal,
		draft: SessionIngestionDraft,
		ingestionId: string,
		sessionDocumentId: string
	) => ({
		source: 'ingestion' as const,
		relatedSessionId: sessionDocumentId,
		ingestionId,
		revisionId: commitRevisionId(mutationId),
		changeSummary:
			proposal.documentType === 'session'
				? `Created from session ingestion: ${draft.title}`
				: `Applied from session: ${draft.title}`
	})

	const applyMutationPlan = (
		input: CommitInput,
		draft: SessionIngestionDraft,
		transcript: string,
		resolvedSelected: SessionProposal[],
		plan: MutationPlan
	): Effect<SessionIngestionResult, Failure> =>
		gen(function* () {
			const committed: SessionIngestionResult['documents'] = []
			const journal: SessionCommitJournal = (storage.readCommitJournal
				? yield* storage.readCommitJournal(input.campaignId, input.ingestionId)
				: undefined) ?? {
				schemaVersion: 1,
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				applied: {}
			}
			const recordApplied = (result: SessionCommitMutationResult) => {
				journal.applied[result.mutationId] = result
				return storage.writeCommitJournal ? storage.writeCommitJournal(journal) : succeed(undefined)
			}
			const appendCommitted = (result: SessionCommitMutationResult) => {
				if (!result.proposalId || !result.documentType) return
				committed.push({
					proposalId: result.proposalId,
					documentId: result.documentId,
					documentType: result.documentType
				})
			}
			const approvedSessionContent = buildSessionRecap(
				draft.title,
				resolvedSelected.filter(({ documentType }) => documentType !== 'session')
			)
			const creates = plan.planned.filter(({ proposal }) => proposal.operation !== 'update-canon')
			const updates = plan.planned.filter(({ proposal }) => proposal.operation === 'update-canon')
			const mutationRank = new Map(
				commitMutationIdsInOrder(plan).map((mutationId, index) => [mutationId, index])
			)
			const orderedCreates = creates.sort(
				(left, right) =>
					(mutationRank.get(left.mutationId) ?? 0) - (mutationRank.get(right.mutationId) ?? 0)
			)
			for (const {
				mutationId,
				proposal,
				documentId,
				path,
				after,
				during,
				eventForm
			} of orderedCreates) {
				const applied = journal.applied[mutationId]
				if (applied) {
					appendCommitted(applied)
					continue
				}
				const revision = revisionFor(
					mutationId,
					proposal,
					draft,
					input.ingestionId,
					plan.sessionDocumentId
				)
				const expected = {
					documentId,
					path: path!,
					type: proposal.documentType,
					content:
						proposal.documentType === 'session'
							? approvedSessionContent
							: canonicalDocumentContent(proposal.title, proposal.content),
					after,
					during,
					eventForm,
					ingestionId: proposal.documentType === 'session' ? input.ingestionId : undefined,
					transcript: proposal.documentType === 'session' ? transcript : undefined,
					revision
				}
				yield* vault.createDocument(input.campaignId, expected)
				const result = {
					mutationId,
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType
				}
				appendCommitted(result)
				yield* recordApplied(result)
			}
			for (const { mutationId, proposal, documentId, after, during, eventForm } of updates) {
				const applied = journal.applied[mutationId]
				if (applied) {
					appendCommitted(applied)
					continue
				}
				const existing = plan.existingById[documentId]!
				yield* vault.updateDocument(input.campaignId, documentId, {
					type: existing.type,
					aliases: existing.aliases,
					after,
					during,
					eventForm,
					content: `${existing.content.trimEnd()}\n\n${proposal.patch!.content.trim()}\n`,
					expectedRevisionId: proposal.base!.revisionId,
					expectedPath: existing.path,
					revision: revisionFor(
						mutationId,
						proposal,
						draft,
						input.ingestionId,
						plan.sessionDocumentId
					)
				})
				const result = {
					mutationId,
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType
				}
				appendCommitted(result)
				yield* recordApplied(result)
			}
			for (const { mutationId, documentId, after, during, eventForm } of plan.chronologyUpdates) {
				if (journal.applied[mutationId]) continue
				const existing = plan.existingById[documentId]!
				yield* vault.updateDocument(input.campaignId, documentId, {
					type: existing.type,
					aliases: existing.aliases,
					after,
					during,
					eventForm,
					content: existing.content,
					expectedRevisionId: existing.currentRevisionId!,
					expectedPath: existing.path,
					revision: {
						source: 'ingestion',
						relatedSessionId: plan.sessionDocumentId,
						ingestionId: input.ingestionId,
						revisionId: commitRevisionId(mutationId),
						changeSummary: `Updated chronology from session: ${draft.title}`
					}
				})
				yield* recordApplied({ mutationId, documentId })
			}
			return { documents: committed, sessionDocumentId: plan.sessionDocumentId }
		})
	return { applyMutationPlan }
}
