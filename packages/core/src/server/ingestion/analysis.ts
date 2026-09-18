import { randomUUID } from 'node:crypto'
import { gen, succeed } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { VaultDocument } from '../vault/types.js'
import { buildSessionRecap } from '../../ingestion.js'
import { chunkTranscript } from './chunking.js'
import { materializeEvidenceRanges } from './evidence.js'
import { mergeClaims, reconcileEventClaims } from './claims.js'
import { allocateIngestionId } from './ids.js'
import { mergeProposals, proposalsForClaim } from './proposals.js'
import type { EvidenceBackedClaim, TranscriptChunk, ValidatedClaim } from './internal.js'
import { entityReferenceId, uniqueEntityReferences } from './text.js'
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
	EntityReference,
	Evidence,
	ExtractedSessionClaim,
	SessionClaimEvidenceRepair,
	SessionClaimValidation,
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
	const discardedClaimWarning = (
		chunk: TranscriptChunk,
		claimIndex: number,
		claim: ExtractedSessionClaim,
		reason: string,
		evidence: Evidence[] = [],
		validationReason?: SessionClaimValidation['reason']
	) => {
		const details = {
			chunkId: chunk.chunkId,
			claim: claimIndex + 1,
			reason,
			validationReason,
			content: claim.content,
			evidenceRanges: claim.evidence,
			evidence: evidence.map(({ startLine, endLine, excerpt }) => ({
				startLine,
				endLine,
				excerpt
			})),
			entityReferences: claim.entityReferences
		}
		if (process.env.NODE_ENV !== 'production') {
			console.warn('[session-ingestion] discarded claim', details)
		}
		return `${chunk.chunkId} claim ${claimIndex + 1} discarded [${reason}]${validationReason ? ` validationReason=${validationReason}` : ''} evidence=${evidenceRangesLabel(claim)} entities=${entityReferencesLabel(claim)} content=${JSON.stringify(claim.content)}`
	}

	const discardedEntityReferenceWarning = (
		chunk: TranscriptChunk,
		claimIndex: number,
		claim: ExtractedSessionClaim,
		reference: EntityReference,
		referenceIndex: number,
		reason: string,
		evidence: Evidence[]
	) => {
		const details = {
			chunkId: chunk.chunkId,
			claim: claimIndex + 1,
			reference: referenceIndex + 1,
			reason,
			content: claim.content,
			entityReference: reference,
			evidence: evidence.map(({ startLine, endLine, excerpt }) => ({
				startLine,
				endLine,
				excerpt
			}))
		}
		if (process.env.NODE_ENV !== 'production') {
			console.warn('[session-ingestion] discarded entity reference', details)
		}
		return `${chunk.chunkId} claim ${claimIndex + 1} entity reference ${referenceIndex + 1} discarded [${reason}] entity=${JSON.stringify(reference.label)} evidence=${evidenceRangesLabel(claim)} content=${JSON.stringify(claim.content)}`
	}

	const evidenceBackedClaims = (
		transcript: string,
		chunk: TranscriptChunk,
		claims: ExtractedSessionClaim[]
	) => {
		const backed: EvidenceBackedClaim[] = []
		const warnings: string[] = []
		for (const [claimIndex, claim] of claims.entries()) {
			const materialized = materializeEvidenceRanges(transcript, chunk, claim.evidence)
			if (!materialized.ok) {
				warnings.push(discardedClaimWarning(chunk, claimIndex, claim, materialized.reason))
				continue
			}
			backed.push({
				candidateId: `${chunk.chunkId}:claim-${claimIndex + 1}`,
				claimIndex,
				claim: { ...claim, entityReferences: uniqueEntityReferences(claim.entityReferences) },
				evidence: materialized.evidence
			})
		}
		return { claims: backed, warnings }
	}
	const applyClaimValidation = (
		chunk: TranscriptChunk,
		backedClaims: EvidenceBackedClaim[],
		validations: SessionClaimValidation[],
		allowEvidenceRepair = true
	) => {
		const validationById = new Map(
			validations.map((validation) => [validation.candidateId, validation])
		)
		const claims: ValidatedClaim[] = []
		const repairable: EvidenceBackedClaim[] = []
		const warnings: string[] = []
		for (const backedClaim of backedClaims) {
			const { candidateId, claimIndex, claim, evidence } = backedClaim
			const validation = validationById.get(candidateId)
			if (!validation?.accepted) {
				if (allowEvidenceRepair && validation?.reason === 'insufficient-evidence') {
					repairable.push(backedClaim)
					continue
				}
				warnings.push(
					discardedClaimWarning(
						chunk,
						claimIndex,
						claim,
						validation
							? allowEvidenceRepair
								? 'validator-rejected'
								: 'validator-rejected-after-repair'
							: 'validator-missing-decision',
						evidence,
						validation?.reason
					)
				)
				continue
			}

			const referenceValidationById = new Map(
				validation.referenceValidations.map((decision) => [decision.referenceId, decision.accepted])
			)
			const entityReferences = claim.entityReferences.filter((reference, referenceIndex) => {
				const accepted = referenceValidationById.get(entityReferenceId(candidateId, referenceIndex))
				if (accepted) return true
				warnings.push(
					discardedEntityReferenceWarning(
						chunk,
						claimIndex,
						claim,
						reference,
						referenceIndex,
						accepted === false
							? 'validator-rejected-reference'
							: 'validator-missing-reference-decision',
						evidence
					)
				)
				return false
			})

			claims.push({
				kind: claim.kind,
				eventTitle: claim.eventTitle,
				content: claim.content,
				entityReferences,
				certainty:
					claim.certainty === 'inferred' || validation.certainty === 'inferred'
						? 'inferred'
						: 'explicit',
				claimId: randomUUID(),
				evidence
			})
		}
		return { claims, repairable, warnings }
	}

	const applyEvidenceRepairs = (
		transcript: string,
		chunk: TranscriptChunk,
		claims: EvidenceBackedClaim[],
		repairs: SessionClaimEvidenceRepair[]
	) => {
		const repairById = new Map(repairs.map((repair) => [repair.candidateId, repair]))
		const repaired: EvidenceBackedClaim[] = []
		const warnings: string[] = []

		for (const backedClaim of claims) {
			const { candidateId, claimIndex, claim, evidence } = backedClaim
			const repair = repairById.get(candidateId)
			if (!repair) {
				warnings.push(
					discardedClaimWarning(
						chunk,
						claimIndex,
						claim,
						'evidence-repair-missing',
						evidence,
						'insufficient-evidence'
					)
				)
				continue
			}

			const repairedClaim = { ...claim, evidence: repair.evidence }
			const materialized = materializeEvidenceRanges(transcript, chunk, repair.evidence)
			if (!materialized.ok) {
				warnings.push(
					discardedClaimWarning(
						chunk,
						claimIndex,
						repairedClaim,
						`evidence-repair-${materialized.reason}`,
						evidence,
						'insufficient-evidence'
					)
				)
				continue
			}

			if (process.env.NODE_ENV !== 'production') {
				console.info('[session-ingestion] repaired claim evidence', {
					chunkId: chunk.chunkId,
					claim: claimIndex + 1,
					content: claim.content,
					previousEvidenceRanges: claim.evidence,
					repairedEvidenceRanges: repair.evidence
				})
			}

			repaired.push({
				...backedClaim,
				claim: repairedClaim,
				evidence: materialized.evidence
			})
		}

		return { claims: repaired, warnings }
	}

	const validateExtractedClaims = (
		transcript: string,
		chunk: TranscriptChunk,
		extracted: ExtractedSessionClaim[]
	) =>
		gen(function* () {
			const backed = evidenceBackedClaims(transcript, chunk, extracted)
			if (!backed.claims.length) {
				return { claims: [] as ValidatedClaim[], warnings: backed.warnings }
			}

			const validations = yield* ai.validateSessionClaims({
				model: ai.analysisModel,
				system: `${validationSystem} ${worldbuildingValidationGuidance}`,
				prompt: validationPrompt(chunk, backed.claims)
			})
			const applied = applyClaimValidation(chunk, backed.claims, validations)
			if (!applied.repairable.length) {
				return {
					claims: applied.claims,
					warnings: [...backed.warnings, ...applied.warnings]
				}
			}

			const repairs = yield* ai.repairSessionClaimEvidence({
				model: ai.analysisModel,
				system: evidenceRepairSystem,
				prompt: evidenceRepairPrompt(chunk, applied.repairable)
			})
			const repaired = applyEvidenceRepairs(transcript, chunk, applied.repairable, repairs)
			if (!repaired.claims.length) {
				return {
					claims: applied.claims,
					warnings: [...backed.warnings, ...applied.warnings, ...repaired.warnings]
				}
			}

			const repairedValidations = yield* ai.validateSessionClaims({
				model: ai.analysisModel,
				system: `${validationSystem} ${worldbuildingValidationGuidance}`,
				prompt: validationPrompt(chunk, repaired.claims)
			})
			const reapplied = applyClaimValidation(chunk, repaired.claims, repairedValidations, false)
			return {
				claims: [...applied.claims, ...reapplied.claims],
				warnings: [
					...backed.warnings,
					...applied.warnings,
					...repaired.warnings,
					...reapplied.warnings
				]
			}
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
