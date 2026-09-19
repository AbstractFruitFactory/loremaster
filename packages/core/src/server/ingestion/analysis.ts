import { randomUUID } from 'node:crypto'
import { gen, succeed } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { VaultDocument } from '../vault/types.js'
import { buildSessionRecap } from '../../ingestion.js'
import { chunkTranscript } from './chunking.js'
import { claimValidation } from './claim-validation.js'
import { mergeClaims, reconcileEventClaims } from './claims.js'
import { allocateIngestionId } from './ids.js'
import { mergeProposals, proposalsForClaim } from './proposals.js'
import type { TranscriptChunk, ValidatedClaim } from './internal.js'
import {
	completeTranscriptChunk,
	evidenceRangesLabel,
	evidenceRepairPrompt,
	evidenceRepairSystem,
	entityReferencesLabel,
	eventAuditPrompt,
	eventAuditSystem,
	extractionSystem,
	transcriptChunkPrompt,
	validationPrompt,
	validationSystem,
	worldbuildingValidationGuidance
} from './prompts.js'
import type { IngestionStorage } from './storage.js'
import type {
	SessionChronologyCoverageProposal,
	SessionChronologyProposal,
	SessionAnalysisStageResult,
	SessionChronologyStageResult,
	SessionIngestionAnalyzeInput,
	SessionIngestionDraft,
	SessionTranscriptData,
	SessionProposal,
	SessionProposalBuildResult
} from './types.js'

export const analysisPipeline = ({
	ai,
	storage,
	retrieveDocuments,
	resolveClaims,
	inferChronology
}: {
	ai: Pick<
		AiProvider,
		| 'analyzeSessionChunk'
		| 'validateSessionClaims'
		| 'repairSessionClaimEvidence'
		| 'auditSessionEvents'
	> & { analysisModel: string }
	storage: IngestionStorage
	retrieveDocuments: (
		campaignId: string,
		claims: ValidatedClaim[]
	) => import('effect/Effect').Effect<VaultDocument[], import('../failure.js').Failure>
	resolveClaims: (
		claims: ValidatedClaim[],
		documents: VaultDocument[]
	) => import('effect/Effect').Effect<
		import('./internal.js').ResolvedClaim[],
		import('../failure.js').Failure
	>
	inferChronology: (
		transcript: string,
		eventProposals: SessionProposal[],
		documents: VaultDocument[]
	) => import('effect/Effect').Effect<
		{
			chronology: import('./types.js').SessionChronologyProposal[]
			coverage: import('./types.js').SessionChronologyCoverageProposal[]
			warnings: string[]
		},
		import('../failure.js').Failure
	>
}) => {
	const { validateExtractedClaims } = claimValidation({
		ai,
		validationSystem: `${validationSystem} ${worldbuildingValidationGuidance}`,
		evidenceRepairSystem,
		validationPrompt,
		evidenceRepairPrompt,
		evidenceRangesLabel,
		entityReferencesLabel,
		logScope: 'session-ingestion'
	})

	const analyzeChunk = (transcript: string, chunk: TranscriptChunk) =>
		gen(function* () {
			const extracted = yield* ai.analyzeSessionChunk({
				model: ai.analysisModel,
				system: extractionSystem,
				prompt: transcriptChunkPrompt(chunk)
			})
			return yield* validateExtractedClaims(transcript, chunk, extracted)
		})

	const sessionProposalFor = (
		title: string,
		claims: ValidatedClaim[],
		claimProposals: SessionProposal[]
	): SessionProposal => ({
		proposalId: randomUUID(),
		claimIds: claims.map(({ claimId }) => claimId),
		operation: 'create-entity',
		documentType: 'session',
		title,
		certainty: 'explicit',
		selected: true,
		evidence: claims.flatMap(({ evidence }) => evidence),
		match: { kind: 'unresolved', candidates: [] },
		references: [],
		content: buildSessionRecap(
			title,
			claimProposals.filter(({ selected }) => selected)
		)
	})
	const auditEvents = (transcript: string, claims: ValidatedClaim[]) =>
		gen(function* () {
			const audit = yield* ai.auditSessionEvents({
				model: ai.analysisModel,
				system: eventAuditSystem,
				prompt: eventAuditPrompt(transcript, claims)
			})
			const candidates = audit.events.filter(
				(event) => event.kind === 'development' && Boolean(event.eventTitle)
			)
			const invalidCandidateCount = audit.events.length - candidates.length
			const validated = candidates.length
				? yield* validateExtractedClaims(
						transcript,
						completeTranscriptChunk(transcript),
						candidates
					)
				: { claims: [] as ValidatedClaim[], warnings: [] as string[] }
			const reconciled = reconcileEventClaims(claims, audit, validated.claims)

			return {
				claims: mergeClaims(reconciled.claims),
				warnings: [
					...(invalidCandidateCount
						? [`Event audit discarded ${invalidCandidateCount} non-development candidate(s)`]
						: []),
					...validated.warnings,
					...reconciled.warnings
				]
			}
		})
	const combineChunkAnalyses = (
		results: SessionAnalysisStageResult[]
	): import('effect/Effect').Effect<SessionAnalysisStageResult> =>
		succeed({
			claims: mergeClaims(results.flatMap(({ claims }) => claims)),
			warnings: results.flatMap(({ warnings }) => warnings)
		})

	const retrieveAnalysisContext = (campaignId: string, claims: ValidatedClaim[]) =>
		retrieveDocuments(campaignId, claims)

	const buildProposals = (
		claims: ValidatedClaim[],
		documents: VaultDocument[]
	): import('effect/Effect').Effect<SessionProposalBuildResult, import('../failure.js').Failure> =>
		gen(function* () {
			const resolvedClaims = yield* resolveClaims(claims, documents)
			return {
				claims,
				proposals: mergeProposals(resolvedClaims.flatMap(proposalsForClaim))
			}
		})

	const inferChronologyStage = (
		transcript: string,
		proposals: SessionProposal[],
		documents: VaultDocument[]
	): import('effect/Effect').Effect<
		SessionChronologyStageResult,
		import('../failure.js').Failure
	> =>
		inferChronology(
			transcript,
			proposals.filter(({ operation }) => operation === 'create-event'),
			documents
		)

	const buildDraft = (
		input: { ingestionId: string; campaignId: string; title: string },
		claims: ValidatedClaim[],
		claimProposals: SessionProposal[],
		chronology: SessionChronologyProposal[],
		chronologyCoverage: SessionChronologyCoverageProposal[],
		warnings: string[]
	): import('effect/Effect').Effect<SessionIngestionDraft> =>
		succeed({
			schemaVersion: 3,
			ingestionId: input.ingestionId,
			campaignId: input.campaignId,
			title: input.title,
			createdAt: new Date().toISOString(),
			warnings,
			proposals: [sessionProposalFor(input.title, claims, claimProposals), ...claimProposals],
			chronology,
			chronologyCoverage
		})

	const persistDraft = (draft: SessionIngestionDraft, transcript: string) =>
		storage.writeDraft ? storage.writeDraft(draft) : storage.write(draft, transcript)

	const analyze = (input: SessionIngestionAnalyzeInput) => {
		const transcriptData: SessionTranscriptData = {
			schemaVersion: 1,
			ingestionId: input.ingestionId ?? allocateIngestionId(),
			campaignId: input.campaignId,
			title: input.title,
			transcript: input.transcript
		}
		return gen(function* () {
			if (storage.writeTranscriptData) yield* storage.writeTranscriptData(transcriptData)
			const results: { claims: ValidatedClaim[]; warnings: string[] }[] = []
			for (const chunk of chunkTranscript(transcriptData.transcript)) {
				results.push(yield* analyzeChunk(transcriptData.transcript, chunk))
			}
			const combined = yield* combineChunkAnalyses(results)
			const audit = yield* auditEvents(transcriptData.transcript, combined.claims)
			const documents = yield* retrieveAnalysisContext(transcriptData.campaignId, audit.claims)
			const proposalBuild = yield* buildProposals(audit.claims, documents)
			const chronology = yield* inferChronologyStage(
				transcriptData.transcript,
				proposalBuild.proposals,
				documents
			)
			const draft = yield* buildDraft(
				transcriptData,
				audit.claims,
				proposalBuild.proposals,
				chronology.chronology,
				chronology.coverage,
				[...combined.warnings, ...audit.warnings, ...chronology.warnings]
			)
			yield* persistDraft(draft, transcriptData.transcript)
			return draft
		})
	}
	return {
		analyze,
		analyzeChunk,
		auditEvents,
		buildDraft,
		buildProposals,
		combineChunkAnalyses,
		inferChronology: inferChronologyStage,
		persistDraft,
		retrieveAnalysisContext
	}
}
