import { fail as failEffect, gen, type Effect } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { Failure } from '../failure.js'
import type { VaultDocument } from '../vault/types.js'
import { validateChronology } from './chronology.js'
import { commitApplication, commitMutationIdsInOrder } from './commit/application.js'
import { planMutations } from './commit/planning.js'
import { campaignImportChronologyId } from './ids.js'
import type { ImportVault } from './import-commit.js'
import type { CampaignImportHistoryRepository } from './import-history.js'
import { importChronologyPrompt, importChronologySystem } from './import-prompts.js'
import type {
	CampaignImportAnalysisStorage,
	CampaignImportBaseCommitStorage,
	CampaignImportChronologyStorage
} from './storage.js'
import type {
	CampaignImportChronologyBuildResult,
	CampaignImportChronologyProposal,
	CampaignImportChronologyCommitData,
	CampaignImportChronologyCommitInput,
	CampaignImportChronologyCommitPlanData,
	CampaignImportChronologyCommittedCompletionData,
	CampaignImportChronologyCompletionData,
	CampaignImportChronologyDraft,
	CampaignImportChronologyProvenanceRecord,
	CampaignImportCompletionData,
	CampaignImportDraft,
	InferredCampaignImportChronology,
	SessionCommitJournal
} from './types.js'

const chronologyFailure = (cause: Record<string, unknown>): Effect<never, Failure> =>
	failEffect({ domain: 'ingestion', operation: 'commitImportChronology', cause })

export const campaignImportChronologyProvenanceRecords = (
	draft: CampaignImportDraft,
	prepared: CampaignImportChronologyCommitPlanData,
	journal: SessionCommitJournal
): Effect<CampaignImportChronologyProvenanceRecord[], Failure> =>
	gen(function* () {
		const claimById = new Map(draft.temporalClaims.map((claim) => [claim.claimId, claim]))
		const sourceById = new Map(draft.sources.map((source) => [source.sourceId, source]))
		const mutationByDocumentId = new Map(
			prepared.plan.chronologyUpdates.map((mutation) => [mutation.documentId, mutation])
		)
		const records: CampaignImportChronologyProvenanceRecord[] = []
		for (const chronology of prepared.selectedChronology) {
			const affectedDocumentIds =
				chronology.relation === 'before'
					? [chronology.target.eventId]
					: [...new Set([chronology.source.eventId, chronology.target.eventId])]
			for (const affectedDocumentId of affectedDocumentIds) {
				const mutation = mutationByDocumentId.get(affectedDocumentId)
				const result = mutation ? journal.applied[mutation.mutationId] : undefined
				if (!result?.revisionId) {
					return yield* chronologyFailure({
						reason: 'missingChronologyRevision',
						chronologyId: chronology.chronologyId,
						affectedDocumentId
					})
				}
				for (const claimId of chronology.supportingClaimIds) {
					const claim = claimById.get(claimId)
					if (!claim) {
						return yield* chronologyFailure({
							reason: 'missingChronologyClaim',
							chronologyId: chronology.chronologyId,
							claimId
						})
					}
					for (const evidence of claim.evidence) {
						const source = sourceById.get(evidence.sourceId)
						if (!source) {
							return yield* chronologyFailure({
								reason: 'missingChronologySource',
								chronologyId: chronology.chronologyId,
								sourceId: evidence.sourceId
							})
						}
						records.push({
							chronologyId: chronology.chronologyId,
							relation: chronology.relation,
							sourceEventId: chronology.source.eventId,
							targetEventId: chronology.target.eventId,
							affectedDocumentId,
							vaultRevisionId: result.revisionId,
							claim,
							source,
							evidence
						})
					}
				}
			}
		}
		return records
	})

type CampaignImportChronologyDependenciesStorage = Pick<
	CampaignImportAnalysisStorage,
	'readCampaignImportDraft'
> &
	Pick<
		CampaignImportBaseCommitStorage,
		'readCampaignImportCompletion' | 'readCommitJournal' | 'writeCommitJournal'
	> &
	CampaignImportChronologyStorage

export const campaignImportChronology = ({
	ai,
	history,
	storage,
	vault
}: {
	ai: Pick<AiProvider, 'inferCampaignImportChronology'> & { analysisModel: string }
	history: CampaignImportHistoryRepository
	storage: CampaignImportChronologyDependenciesStorage
	vault: ImportVault
}) => {
	const { applyMutationPlan } = commitApplication(vault, storage)

	const readDraft = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportDraft, Failure> =>
		storage.readCampaignImportDraft(campaignId, ingestionId)

	const requireBaseCompletion = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportCompletionData, Failure> =>
		gen(function* () {
			const completion = yield* storage.readCampaignImportCompletion(campaignId, ingestionId)
			return completion ? completion : yield* chronologyFailure({ reason: 'baseImportIncomplete' })
		})

	const readJournal = (
		campaignId: string,
		ingestionId: string
	): Effect<SessionCommitJournal, Failure> =>
		gen(function* () {
			const journal = yield* storage.readCommitJournal(campaignId, ingestionId)
			return (
				journal ?? {
					schemaVersion: 1,
					campaignId,
					ingestionId,
					applied: {}
				}
			)
		})

	const buildDraft = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportChronologyBuildResult, Failure> =>
		gen(function* () {
			yield* requireBaseCompletion(campaignId, ingestionId)
			const draft = yield* readDraft(campaignId, ingestionId)
			const journal = yield* readJournal(campaignId, ingestionId)
			const documents = yield* vault.getDocuments(campaignId)
			const proposalById = new Map(
				draft.proposals.map((proposal) => [proposal.proposalId, proposal])
			)
			const temporalClaimIds = new Set(draft.temporalClaims.map(({ claimId }) => claimId))
			const eventProposals = Object.values(journal.applied).flatMap((result) => {
				if (!result.proposalId || result.documentType !== 'event') return []
				const proposal = proposalById.get(result.proposalId)
				return proposal?.documentType === 'event'
					? [
							{
								...proposal,
								proposalId: result.documentId,
								claimIds: proposal.claimIds.filter((claimId) => temporalClaimIds.has(claimId))
							}
						]
					: []
			})
			const committedEventIds = new Set(eventProposals.map(({ proposalId }) => proposalId))
			const acceptedClaimIds = new Set(eventProposals.flatMap(({ claimIds }) => claimIds))
			const acceptedClaims = draft.temporalClaims.filter(({ claimId }) =>
				acceptedClaimIds.has(claimId)
			)
			const claimById = new Map(acceptedClaims.map((claim) => [claim.claimId, claim]))
			const existingEvents = documents.filter(
				({ id, type }) => type === 'event' && !committedEventIds.has(id)
			)
			let inference: InferredCampaignImportChronology
			const shortCircuited =
				!eventProposals.length || eventProposals.length + existingEvents.length < 2
			if (shortCircuited) {
				inference = {
					relations: [],
					coverage: eventProposals.map((proposal) => ({
						eventId: proposal.proposalId,
						status: 'intentionally-unplaced',
						reason: 'No other event is available to establish a relative placement.'
					}))
				}
			} else {
				inference = yield* ai.inferCampaignImportChronology({
					model: ai.analysisModel,
					system: importChronologySystem,
					prompt: importChronologyPrompt(acceptedClaims, eventProposals, existingEvents)
				})
			}

			const supportByRelation = new Map<
				string,
				Pick<CampaignImportChronologyProposal, 'evidence' | 'supportingClaimIds'>
			>()
			const evidenceWarnings: string[] = []
			const supportedRelations = inference.relations.flatMap(({ claimIds, ...relation }) => {
				const key = `${relation.relation}\0${relation.sourceEventId}\0${relation.targetEventId}`
				const uniqueClaimIds = [...new Set(claimIds)]
				if (!uniqueClaimIds.length) {
					evidenceWarnings.push(
						`Chronology relation discarded [missing-evidence] ${JSON.stringify(relation)}`
					)
					return []
				}
				const unsupportedClaimIds = uniqueClaimIds.filter((claimId) => !claimById.has(claimId))
				if (unsupportedClaimIds.length) {
					evidenceWarnings.push(
						`Chronology relation discarded [unsupported-evidence] claimIds=${JSON.stringify(unsupportedClaimIds)} ${JSON.stringify(relation)}`
					)
					return []
				}
				const evidence = [
					...new Map(
						uniqueClaimIds
							.flatMap((claimId) => claimById.get(claimId)!.evidence)
							.map((item) => [
								`${item.sourceId}\0${item.sourceRevisionId}\0${item.startStringIndex}\0${item.endStringIndex}`,
								item
							])
					).values()
				]
				if (!evidence.length) {
					evidenceWarnings.push(
						`Chronology relation discarded [missing-evidence] ${JSON.stringify(relation)}`
					)
					return []
				}
				const existingSupport = supportByRelation.get(key)
				supportByRelation.set(key, {
					supportingClaimIds: [
						...new Set([...(existingSupport?.supportingClaimIds ?? []), ...uniqueClaimIds])
					],
					evidence: [
						...new Map(
							[...(existingSupport?.evidence ?? []), ...evidence].map((item) => [
								`${item.sourceId}\0${item.sourceRevisionId}\0${item.startStringIndex}\0${item.endStringIndex}`,
								item
							])
						).values()
					]
				})
				return [relation]
			})
			const inferred = validateChronology(
				{ relations: supportedRelations, coverage: inference.coverage },
				eventProposals,
				existingEvents
			)
			const chronologyProposals: CampaignImportChronologyProposal[] = inferred.chronology.flatMap(
				(proposal) => {
					const support = supportByRelation.get(
						`${proposal.relation}\0${proposal.source.eventId}\0${proposal.target.eventId}`
					)
					if (!support?.evidence.length) {
						evidenceWarnings.push(
							`Chronology relation discarded [missing-evidence] ${JSON.stringify(proposal)}`
						)
						return []
					}
					return [
						{
							...proposal,
							chronologyId: campaignImportChronologyId(
								ingestionId,
								proposal.relation,
								proposal.source.eventId,
								proposal.target.eventId
							),
							source: { ...proposal.source, source: 'existing' as const },
							target: { ...proposal.target, source: 'existing' as const },
							...support
						}
					]
				}
			)
			const chronologyDraft: CampaignImportChronologyDraft = {
				schemaVersion: 1,
				kind: 'campaign-import-chronology',
				campaignId,
				ingestionId,
				createdAt: draft.createdAt,
				chronology: chronologyProposals,
				chronologyCoverage: inferred.coverage.map((coverage) => ({
					...coverage,
					event: { ...coverage.event, source: 'existing' as const }
				})),
				warnings: [...evidenceWarnings, ...inferred.warnings]
			}
			return {
				draft: chronologyDraft,
				...(chronologyProposals.length === 0
					? {
							outcome: {
								schemaVersion: 1 as const,
								kind: 'campaign-import-chronology-no-relations' as const,
								campaignId,
								ingestionId,
								updatedDocumentIds: [] as [],
								finalized: true
							}
						}
					: {})
			}
		})

	const persistDraft = ({
		draft,
		outcome
	}: CampaignImportChronologyBuildResult): Effect<void, Failure> =>
		gen(function* () {
			yield* storage.writeCampaignImportChronologyDraft(draft)
			if (outcome) yield* storage.writeCampaignImportChronologyCompletion(outcome)
		})

	const analyze = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportChronologyDraft, Failure> =>
		gen(function* () {
			const built = yield* buildDraft(campaignId, ingestionId)
			yield* persistDraft(built)
			return built.draft
		})

	const getDraft = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportChronologyDraft, Failure> =>
		storage.readCampaignImportChronologyDraft(campaignId, ingestionId)

	const persistCommitData = (
		input: CampaignImportChronologyCommitInput
	): Effect<CampaignImportChronologyCommitData, Failure> =>
		gen(function* () {
			const data: CampaignImportChronologyCommitData = {
				schemaVersion: 1,
				kind: 'campaign-import-chronology-commit',
				...input
			}
			yield* storage.writeCampaignImportChronologyCommitData(data)
			return data
		})

	const getCommitData = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportChronologyCommitData, Failure> =>
		storage.readCampaignImportChronologyCommitData(campaignId, ingestionId)

	const planCommit = (
		input: CampaignImportChronologyCommitData
	): Effect<CampaignImportChronologyCommitPlanData, Failure> =>
		gen(function* () {
			yield* requireBaseCompletion(input.campaignId, input.ingestionId)
			const existing = yield* storage.readCampaignImportChronologyCommitPlan(
				input.campaignId,
				input.ingestionId
			)
			if (existing) return existing
			const draft = yield* getDraft(input.campaignId, input.ingestionId)
			const selectedIds = new Set(input.selectedChronologyIds)
			const byId = new Map(draft.chronology.map((proposal) => [proposal.chronologyId, proposal]))
			if (
				selectedIds.size !== input.selectedChronologyIds.length ||
				[...selectedIds].some((chronologyId) => !byId.has(chronologyId))
			) {
				return yield* chronologyFailure({ reason: 'unknownChronology' })
			}
			const selected = [...selectedIds].map((chronologyId) => byId.get(chronologyId)!)
			const documents = yield* vault.getDocuments(input.campaignId)
			const plan = yield* planMutations(input.ingestionId, [], selected, undefined, documents)
			const prepared: CampaignImportChronologyCommitPlanData = {
				schemaVersion: 1,
				kind: 'campaign-import-chronology-commit-plan',
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				selectedChronology: selected,
				plan
			}
			yield* storage.writeCampaignImportChronologyCommitPlan(prepared)
			return prepared
		})

	const applyCommitMutation = (
		input: CampaignImportChronologyCommitData,
		prepared: CampaignImportChronologyCommitPlanData,
		mutationId: string
	) =>
		gen(function* () {
			const chronologyUpdates = prepared.plan.chronologyUpdates.filter(
				(mutation) => mutation.mutationId === mutationId
			)
			if (!chronologyUpdates.length || prepared.plan.planned.length) {
				return yield* chronologyFailure({ reason: 'unknownMutation', mutationId })
			}
			return yield* applyMutationPlan(
				{
					campaignId: input.campaignId,
					ingestionId: input.ingestionId,
					selectedProposalIds: []
				},
				{ kind: 'campaign-import' },
				[],
				{ ...prepared.plan, planned: [], chronologyUpdates },
				undefined
			)
		})

	const finalizeCommit = (
		input: CampaignImportChronologyCommitData,
		prepared: CampaignImportChronologyCommitPlanData
	): Effect<CampaignImportChronologyCommittedCompletionData, Failure> =>
		gen(function* () {
			const existing = yield* storage.readCampaignImportChronologyCompletion(
				input.campaignId,
				input.ingestionId
			)
			if (existing?.kind === 'campaign-import-chronology-completion') return existing
			if (existing) {
				return yield* chronologyFailure({ reason: 'conflictingChronologyOutcome' })
			}
			const mutationIds = commitMutationIdsInOrder(prepared.plan)
			const journal = yield* readJournal(input.campaignId, input.ingestionId)
			const missingMutationIds = mutationIds.filter((mutationId) => !journal.applied[mutationId])
			if (missingMutationIds.length) {
				return yield* chronologyFailure({ reason: 'incompleteCommit', missingMutationIds })
			}
			const draft = yield* readDraft(input.campaignId, input.ingestionId)
			const records = yield* campaignImportChronologyProvenanceRecords(draft, prepared, journal)
			yield* history.recordChronologyProvenance(input.campaignId, input.ingestionId, records)
			const completion: CampaignImportChronologyCommittedCompletionData = {
				schemaVersion: 1,
				kind: 'campaign-import-chronology-completion',
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				updatedDocumentIds: prepared.plan.chronologyUpdates.map(({ documentId }) => documentId),
				finalized: true
			}
			yield* storage.writeCampaignImportChronologyCompletion(completion)
			return completion
		})

	const commit = (
		input: CampaignImportChronologyCommitInput
	): Effect<CampaignImportChronologyCompletionData, Failure> =>
		gen(function* () {
			const data = yield* persistCommitData(input)
			const prepared = yield* planCommit(data)
			for (const mutationId of commitMutationIdsInOrder(prepared.plan)) {
				yield* applyCommitMutation(data, prepared, mutationId)
			}
			return yield* finalizeCommit(data, prepared)
		})

	return {
		analyze,
		applyCommitMutation,
		buildDraft,
		commit,
		commitMutationIds: (prepared: CampaignImportChronologyCommitPlanData) =>
			commitMutationIdsInOrder(prepared.plan),
		finalizeCommit,
		getCommitData,
		getDraft,
		persistDraft,
		persistCommitData,
		planCommit
	}
}
