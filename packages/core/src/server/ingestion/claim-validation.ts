import { randomUUID } from 'node:crypto'
import { gen } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import { materializeEvidenceRanges } from './evidence.js'
import type { EvidenceBackedClaim, ValidatedClaim } from './internal.js'
import { entityReferenceId, uniqueEntityReferences } from './text.js'
import type {
	EntityReference,
	Evidence,
	ExtractedSessionClaim,
	SessionClaimEvidenceRepair,
	SessionClaimValidation,
	TranscriptChunk
} from './types.js'

type ClaimValidationOptions = {
	ai: Pick<AiProvider, 'validateSessionClaims' | 'repairSessionClaimEvidence'> & {
		analysisModel: string
	}
	validationSystem: string
	evidenceRepairSystem: string
	validationPrompt: (chunk: TranscriptChunk, claims: EvidenceBackedClaim[]) => string
	evidenceRepairPrompt: (chunk: TranscriptChunk, claims: EvidenceBackedClaim[]) => string
	evidenceRangesLabel: (claim: ExtractedSessionClaim) => string
	entityReferencesLabel: (claim: ExtractedSessionClaim) => string
	logScope: string
	evidenceMetadata?: Pick<Evidence, 'sourceId' | 'sourceRevisionId'>
	claimId?: (claim: ExtractedSessionClaim, evidence: Evidence[]) => string
}

export const claimValidation = ({
	ai,
	validationSystem,
	evidenceRepairSystem,
	validationPrompt,
	evidenceRepairPrompt,
	evidenceRangesLabel,
	entityReferencesLabel,
	logScope,
	evidenceMetadata,
	claimId = () => randomUUID()
}: ClaimValidationOptions) => {
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
			console.warn(`[${logScope}] discarded claim`, details)
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
			console.warn(`[${logScope}] discarded entity reference`, details)
		}
		return `${chunk.chunkId} claim ${claimIndex + 1} entity reference ${referenceIndex + 1} discarded [${reason}] entity=${JSON.stringify(reference.label)} evidence=${evidenceRangesLabel(claim)} content=${JSON.stringify(claim.content)}`
	}

	const missingSubjectWarning = (
		chunk: TranscriptChunk,
		claimIndex: number,
		claim: ExtractedSessionClaim,
		evidence: Evidence[]
	) => {
		const details = {
			chunkId: chunk.chunkId,
			claim: claimIndex + 1,
			reason: 'no-accepted-subject',
			content: claim.content,
			evidence: evidence.map(({ startLine, endLine, excerpt }) => ({
				startLine,
				endLine,
				excerpt
			}))
		}
		if (process.env.NODE_ENV !== 'production') {
			console.warn(`[${logScope}] stable fact retained as record-only`, details)
		}
		return `${chunk.chunkId} claim ${claimIndex + 1} retained as record-only [no-accepted-subject] evidence=${evidenceRangesLabel(claim)} content=${JSON.stringify(claim.content)}`
	}

	const evidenceBackedClaims = (
		text: string,
		chunk: TranscriptChunk,
		claims: ExtractedSessionClaim[]
	) => {
		const backed: EvidenceBackedClaim[] = []
		const warnings: string[] = []
		for (const [claimIndex, claim] of claims.entries()) {
			const materialized = materializeEvidenceRanges(text, chunk, claim.evidence)
			if (!materialized.ok) {
				warnings.push(discardedClaimWarning(chunk, claimIndex, claim, materialized.reason))
				continue
			}
			backed.push({
				candidateId: `${chunk.chunkId}:claim-${claimIndex + 1}`,
				claimIndex,
				claim: { ...claim, entityReferences: uniqueEntityReferences(claim.entityReferences) },
				evidence: materialized.evidence.map((item) => ({ ...item, ...evidenceMetadata }))
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

			if (claim.kind === 'stable-fact') {
				const subjects = entityReferences.filter(({ role }) => role === 'subject')
				if (subjects.length > 1) {
					warnings.push(
						discardedClaimWarning(chunk, claimIndex, claim, 'multiple-accepted-subjects', evidence)
					)
					continue
				}
				if (!subjects.length) {
					warnings.push(missingSubjectWarning(chunk, claimIndex, claim, evidence))
				}
			}

			claims.push({
				kind: claim.kind,
				eventTitle: claim.eventTitle,
				content: claim.content,
				entityReferences,
				certainty:
					claim.certainty === 'inferred' || validation.certainty === 'inferred'
						? 'inferred'
						: 'explicit',
				claimId: claimId({ ...claim, entityReferences }, evidence),
				evidence
			})
		}
		return { claims, repairable, warnings }
	}

	const applyEvidenceRepairs = (
		text: string,
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
			const materialized = materializeEvidenceRanges(text, chunk, repair.evidence)
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
				console.info(`[${logScope}] repaired claim evidence`, {
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
				evidence: materialized.evidence.map((item) => ({ ...item, ...evidenceMetadata }))
			})
		}

		return { claims: repaired, warnings }
	}

	const validateExtractedClaims = (
		text: string,
		chunk: TranscriptChunk,
		extracted: ExtractedSessionClaim[]
	) =>
		gen(function* () {
			const backed = evidenceBackedClaims(text, chunk, extracted)
			if (!backed.claims.length) {
				return { claims: [] as ValidatedClaim[], warnings: backed.warnings }
			}

			const validations = yield* ai.validateSessionClaims({
				model: ai.analysisModel,
				system: validationSystem,
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
			const repaired = applyEvidenceRepairs(text, chunk, applied.repairable, repairs)
			if (!repaired.claims.length) {
				return {
					claims: applied.claims,
					warnings: [...backed.warnings, ...applied.warnings, ...repaired.warnings]
				}
			}

			const repairedValidations = yield* ai.validateSessionClaims({
				model: ai.analysisModel,
				system: validationSystem,
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

	return { validateExtractedClaims }
}
