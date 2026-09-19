import { fail as failEffect, gen, map, type Effect } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { Failure } from '../failure.js'
import type { VaultDocument } from '../vault/types.js'
import { analysisPipeline } from './analysis.js'
import { chronology } from './chronology.js'
import {
	commitApplication,
	commitMutationIdsInOrder,
	optionalCommitJournalStorage
} from './commit/application.js'
import { planMutations } from './commit/planning.js'
import { commitSelection } from './commit/selection.js'
import { entityResolution } from './entity-resolution.js'
import { allocateIngestionId } from './ids.js'
import type { CommitInput, MutationPlan } from './internal.js'
import type { IngestionStorage } from './storage.js'
import type {
	SessionCommitData,
	SessionIngestionDraft,
	SessionIngestionResult,
	SessionIngestionSummary,
	SessionProposal,
	SessionTranscriptData
} from './types.js'

export type SessionIngestionDependencies = {
	ai: Pick<
		AiProvider,
		| 'analyzeSessionChunk'
		| 'validateSessionClaims'
		| 'repairSessionClaimEvidence'
		| 'resolveSessionEntities'
		| 'auditSessionEvents'
		| 'inferSessionChronology'
	> & {
		analysisModel: string
	}
	storage: IngestionStorage
	retrieveAnalysisDocuments: (
		campaignId: string,
		claims: import('./types.js').SessionValidatedClaim[]
	) => Effect<VaultDocument[], Failure>
	vault: {
		getDocuments: (campaignId: string) => Effect<VaultDocument[], Failure>
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
	}
}

export const sessionIngestion = ({
	ai,
	storage,
	retrieveAnalysisDocuments,
	vault
}: SessionIngestionDependencies) => {
	const { resolveClaims } = entityResolution(ai)
	const { inferChronology } = chronology(ai)
	const analysisStages = analysisPipeline({
		ai,
		storage,
		retrieveDocuments: retrieveAnalysisDocuments,
		resolveClaims,
		inferChronology
	})
	const { loadCommitContext, validateSelection, resolveSelectedProposals } = commitSelection({
		storage,
		vault
	})
	const { applyMutationPlan } = commitApplication(
		vault as Parameters<typeof commitApplication>[0],
		optionalCommitJournalStorage(storage)
	)

	const planCommit = (input: CommitInput) =>
		gen(function* () {
			if (storage.writeCommitData) {
				yield* storage.writeCommitData({
					schemaVersion: 1,
					campaignId: input.campaignId,
					ingestionId: input.ingestionId,
					selectedProposalIds: input.selectedProposalIds,
					...(input.selectedChronologyIds
						? { selectedChronologyIds: input.selectedChronologyIds }
						: {}),
					...(input.resolutions ? { resolutions: input.resolutions } : {})
				})
			}
			const [draft, transcript, documents] = yield* loadCommitContext(input)
			const selection = yield* validateSelection(input, draft)
			const resolvedSelected = yield* resolveSelectedProposals(
				input,
				selection.selectedIds,
				selection.selected
			)
			const plan = yield* planMutations(
				input.ingestionId,
				resolvedSelected,
				selection.selectedChronology,
				selection.sessionProposal,
				documents
			)
			return { draft, transcript, resolvedSelected, plan }
		})

	const applyCommitPlan = (
		input: CommitInput,
		prepared: {
			draft: SessionIngestionDraft
			transcript: string
			resolvedSelected: SessionProposal[]
			plan: MutationPlan
		}
	): Effect<SessionIngestionResult, Failure> =>
		map(
			applyMutationPlan(
				input,
				{ kind: 'session', draft: prepared.draft, transcript: prepared.transcript },
				prepared.resolvedSelected,
				prepared.plan
			),
			(result) => ({ ...result, sessionDocumentId: result.sessionDocumentId! })
		)

	const commit = (input: CommitInput): Effect<SessionIngestionResult, Failure> =>
		gen(function* () {
			const prepared = yield* planCommit(input)
			return yield* applyCommitPlan(input, prepared)
		})

	const persistTranscriptData = (data: SessionTranscriptData): Effect<void, Failure> =>
		storage.writeTranscriptData
			? storage.writeTranscriptData(data)
			: failEffect({
					domain: 'ingestionStorage',
					operation: 'writeTranscriptData',
					cause: { reason: 'unsupported' }
				})

	const getTranscriptData = (
		campaignId: string,
		ingestionId: string
	): Effect<SessionTranscriptData, Failure> =>
		storage.readTranscriptData
			? storage.readTranscriptData(campaignId, ingestionId)
			: failEffect({
					domain: 'ingestionStorage',
					operation: 'readTranscriptData',
					cause: { reason: 'unsupported' }
				})

	const getCommitData = (
		campaignId: string,
		ingestionId: string
	): Effect<SessionCommitData, Failure> =>
		storage.readCommitData
			? storage.readCommitData(campaignId, ingestionId)
			: failEffect({
					domain: 'ingestionStorage',
					operation: 'readCommitData',
					cause: { reason: 'unsupported' }
				})

	const persistCommitData = (data: SessionCommitData): Effect<void, Failure> =>
		storage.writeCommitData
			? storage.writeCommitData(data)
			: failEffect({
					domain: 'ingestionStorage',
					operation: 'writeCommitData',
					cause: { reason: 'unsupported' }
				})

	const listUncommitted = (campaignId: string): Effect<SessionIngestionSummary[], Failure> => {
		const list = storage.list
		if (!list) {
			return failEffect({
				domain: 'ingestionStorage',
				operation: 'list',
				cause: { reason: 'unsupported' }
			})
		}
		return gen(function* () {
			const summaries = yield* list(campaignId)
			const documents = yield* vault.getDocuments(campaignId)
			const committedIngestionIds = new Set(
				documents.flatMap(({ type, ingestionId }) =>
					type === 'session' && ingestionId ? [ingestionId] : []
				)
			)
			return summaries.filter(({ ingestionId }) => !committedIngestionIds.has(ingestionId))
		})
	}

	const discard = (campaignId: string, ingestionId: string): Effect<void, Failure> =>
		storage.discard
			? storage.discard(campaignId, ingestionId)
			: failEffect({
					domain: 'ingestionStorage',
					operation: 'discard',
					cause: { reason: 'unsupported' }
				})

	const applyCommitMutation = (
		input: CommitInput,
		prepared: Parameters<typeof applyCommitPlan>[1],
		mutationId: string
	): Effect<SessionIngestionResult, Failure> => {
		const planned = prepared.plan.planned.filter((mutation) => mutation.mutationId === mutationId)
		const chronologyUpdates = prepared.plan.chronologyUpdates.filter(
			(mutation) => mutation.mutationId === mutationId
		)
		if (!planned.length && !chronologyUpdates.length) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unknownMutation', mutationId }
			})
		}
		return applyCommitPlan(input, {
			...prepared,
			plan: { ...prepared.plan, planned, chronologyUpdates }
		})
	}

	return {
		allocateIngestionId,
		analysisStages,
		analyze: analysisStages.analyze,
		applyCommitPlan,
		applyCommitMutation,
		commitMutationIds: (prepared: Parameters<typeof applyCommitPlan>[1]) =>
			commitMutationIdsInOrder(prepared.plan),
		commit,
		getTranscriptData,
		getCommitData,
		getDraft: storage.read,
		listUncommitted,
		discard,
		persistTranscriptData,
		persistCommitData,
		planCommit
	}
}

export type { CommitInput } from './internal.js'
export { allocateIngestionId } from './ids.js'
export { campaignImport } from './import-analysis.js'
export { reconcileCampaignImportClaims } from './import-reconciliation.js'
export * from './types.js'
