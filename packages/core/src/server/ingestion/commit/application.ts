import { fail as failEffect, gen, succeed, type Effect } from 'effect/Effect'
import { buildSessionRecap, canonicalDocumentContent } from '../../../ingestion.js'
import type { Failure } from '../../failure.js'
import { topologicalLayers } from '../../timeline/graph.js'
import type { VaultDocument } from '../../vault/types.js'
import { commitRevisionId } from '../ids.js'
import type { CommitInput, MutationPlan } from '../internal.js'
import type { CampaignImportBaseCommitStorage, IngestionStorage } from '../storage.js'
import type {
	SessionCommitJournal,
	SessionCommitMutationResult,
	SessionIngestionDraft,
	SessionIngestionResult,
	SessionProposal
} from '../types.js'

export type CommitApplicationResult = {
	documents: SessionIngestionResult['documents']
	sessionDocumentId?: string
}

type CommitApplicationContext =
	| {
			kind: 'session'
			draft: Pick<SessionIngestionDraft, 'title'>
			transcript: string
	  }
	| { kind: 'campaign-import' }

export type CommitJournalStorage = Pick<
	CampaignImportBaseCommitStorage,
	'readCommitJournal' | 'writeCommitJournal'
>

export const optionalCommitJournalStorage = (
	storage: Pick<IngestionStorage, 'readCommitJournal' | 'writeCommitJournal'>
): CommitJournalStorage => ({
	readCommitJournal: (campaignId, ingestionId) =>
		storage.readCommitJournal
			? storage.readCommitJournal(campaignId, ingestionId)
			: succeed(undefined),
	writeCommitJournal: (journal) =>
		storage.writeCommitJournal ? storage.writeCommitJournal(journal) : succeed(undefined)
})

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
					relatedSessionId?: string
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
					relatedSessionId?: string
					ingestionId: string
					changeSummary: string
					revisionId: string
				}
			}
		) => Effect<VaultDocument, Failure>
	},
	storage: CommitJournalStorage
) => {
	const revisionFor = (
		mutationId: string,
		proposal: SessionProposal,
		ingestionId: string,
		sessionDocumentId: string | undefined,
		context: CommitApplicationContext
	) => ({
		source: 'ingestion' as const,
		...(sessionDocumentId ? { relatedSessionId: sessionDocumentId } : {}),
		ingestionId,
		revisionId: commitRevisionId(mutationId),
		changeSummary:
			context.kind === 'campaign-import'
				? 'Applied from campaign import'
				: proposal.documentType === 'session'
					? `Created from session ingestion: ${context.draft.title}`
					: `Applied from session: ${context.draft.title}`
	})

	const applyMutationPlan = (
		input: CommitInput,
		context: CommitApplicationContext,
		resolvedSelected: SessionProposal[],
		plan: MutationPlan,
		onApplied?: (
			result: SessionCommitMutationResult,
			proposal: SessionProposal
		) => Effect<void, Failure>
	): Effect<CommitApplicationResult, Failure> =>
		gen(function* () {
			const committed: SessionIngestionResult['documents'] = []
			const journal: SessionCommitJournal = (yield* storage.readCommitJournal(
				input.campaignId,
				input.ingestionId
			)) ?? {
				schemaVersion: 1,
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				applied: {}
			}
			const recordApplied = (result: SessionCommitMutationResult) => {
				journal.applied[result.mutationId] = result
				return storage.writeCommitJournal(journal)
			}
			const appendCommitted = (result: SessionCommitMutationResult) => {
				if (!result.proposalId || !result.documentType) return
				committed.push({
					proposalId: result.proposalId,
					documentId: result.documentId,
					documentType: result.documentType
				})
			}
			const applyRecorded = (result: SessionCommitMutationResult, proposal: SessionProposal) =>
				onApplied ? onApplied(result, proposal) : succeed(undefined)
			const approvedSessionContent =
				context.kind === 'session'
					? buildSessionRecap(
							context.draft.title,
							resolvedSelected.filter(({ documentType }) => documentType !== 'session')
						)
					: undefined
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
					yield* applyRecorded(applied, proposal)
					continue
				}
				const revision = revisionFor(
					mutationId,
					proposal,
					input.ingestionId,
					plan.sessionDocumentId,
					context
				)
				const expected = {
					documentId,
					path: path!,
					type: proposal.documentType,
					content:
						proposal.documentType === 'session' && approvedSessionContent
							? approvedSessionContent
							: canonicalDocumentContent(proposal.title, proposal.content),
					after,
					during,
					eventForm,
					ingestionId: proposal.documentType === 'session' ? input.ingestionId : undefined,
					transcript:
						proposal.documentType === 'session' && context.kind === 'session'
							? context.transcript
							: undefined,
					revision
				}
				const document = yield* vault.createDocument(input.campaignId, expected)
				const result = {
					mutationId,
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType,
					revisionId: document.currentRevisionId
				}
				appendCommitted(result)
				yield* applyRecorded(result, proposal)
				yield* recordApplied(result)
			}
			for (const { mutationId, proposal, documentId, update } of updates) {
				const applied = journal.applied[mutationId]
				if (applied) {
					appendCommitted(applied)
					yield* applyRecorded(applied, proposal)
					continue
				}
				if (!update) {
					return yield* failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'missingUpdateBase', proposalId: proposal.proposalId }
					} satisfies Failure)
				}
				const document = yield* vault.updateDocument(input.campaignId, documentId, {
					...update,
					revision: revisionFor(
						mutationId,
						proposal,
						input.ingestionId,
						plan.sessionDocumentId,
						context
					)
				})
				const result = {
					mutationId,
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType,
					revisionId: document.currentRevisionId
				}
				appendCommitted(result)
				yield* applyRecorded(result, proposal)
				yield* recordApplied(result)
			}
			for (const { mutationId, documentId, update } of plan.chronologyUpdates) {
				if (journal.applied[mutationId]) continue
				const document = yield* vault.updateDocument(input.campaignId, documentId, {
					...update,
					revision: {
						source: 'ingestion',
						...(plan.sessionDocumentId ? { relatedSessionId: plan.sessionDocumentId } : {}),
						ingestionId: input.ingestionId,
						revisionId: commitRevisionId(mutationId),
						changeSummary:
							context.kind === 'campaign-import'
								? 'Updated chronology from campaign import'
								: `Updated chronology from session: ${context.draft.title}`
					}
				})
				yield* recordApplied({
					mutationId,
					documentId,
					revisionId: document.currentRevisionId
				})
			}
			return { documents: committed, sessionDocumentId: plan.sessionDocumentId }
		})
	return { applyMutationPlan }
}
