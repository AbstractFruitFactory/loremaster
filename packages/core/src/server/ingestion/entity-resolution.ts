import { randomUUID } from 'node:crypto'
import { map, succeed } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { judgeEntityIdentity, type EntityIdentityDecision } from './entity-judgment.js'
import type { AiProvider } from '../ai/provider.js'
import { retrieveEntityCandidates } from './entity-candidates.js'
import type { VaultDocument } from '../vault/types.js'
import { matchDocument } from './matching.js'
import type {
	EntityReferenceOccurrence,
	EntityResolution,
	ModelResolutionRequest,
	ResolvedClaim,
	SessionEntityCandidate,
	ValidatedClaim
} from './internal.js'
import { canCreateEntityFromReference, sessionCandidateTitle } from './proposals.js'
import { combineContent, displayTitle, normalize, uniqueStrings } from './text.js'

export const entityResolution = (
	ai: Pick<AiProvider, 'resolveSessionEntities'> & { analysisModel: string }
) => {
	const createEntityReferenceOccurrences = (
		claims: ValidatedClaim[],
		documents: VaultDocument[]
	): EntityReferenceOccurrence[] =>
		claims.flatMap((claim) => [
			...claim.entityReferences.map((reference) => ({
				referenceId: randomUUID(),
				purpose: 'entity-reference' as const,
				claim,
				reference,
				match: matchDocument(reference.label, documents, reference.type)
			})),
			...(claim.kind === 'development' && claim.eventTitle
				? [
						{
							referenceId: randomUUID(),
							purpose: 'development-event' as const,
							claim,
							reference: {
								label: claim.eventTitle,
								type: 'event' as const,
								role: 'subject' as const
							},
							match: matchDocument(claim.eventTitle, documents, 'event')
						}
					]
				: [])
		])

	const resolveExactOccurrences = (
		occurrences: EntityReferenceOccurrence[],
		documents: VaultDocument[]
	) => {
		const resolutions = new Map<string, EntityResolution>()
		for (const occurrence of occurrences) {
			const match = occurrence.match
			if (match.kind !== 'exact') continue
			const document = documents.find(({ id }) => id === match.documentId)
			if (!document?.currentRevisionId) continue
			resolutions.set(occurrence.referenceId, {
				kind: 'existing',
				reference: occurrence.reference,
				document: document as VaultDocument & { currentRevisionId: string },
				method: 'deterministic'
			})
		}
		return resolutions
	}

	const unresolvedOccurrences = (
		occurrences: EntityReferenceOccurrence[],
		resolutions: Map<string, EntityResolution>
	) => occurrences.filter(({ referenceId }) => !resolutions.has(referenceId))

	const canCreateOccurrence = (occurrence: EntityReferenceOccurrence) =>
		occurrence.purpose === 'development-event' || canCreateEntityFromReference(occurrence.reference)

	const creatableSessionOccurrences = (occurrences: EntityReferenceOccurrence[]) =>
		occurrences.filter(
			(occurrence) => occurrence.match.kind === 'unresolved' && canCreateOccurrence(occurrence)
		)

	const buildSessionCandidates = (provisional: EntityReferenceOccurrence[]) => {
		const candidates = new Map<string, SessionEntityCandidate>()
		const byReference = new Map<string, SessionEntityCandidate>()
		for (const occurrence of provisional) {
			const rawTitle = sessionCandidateTitle(occurrence, provisional)
			if (!rawTitle) continue
			const title = displayTitle(rawTitle)
			const key = `${occurrence.reference.type}:${normalize(title)}`
			const candidate = candidates.get(key) ?? {
				targetId: `session:${key}`,
				title,
				type: occurrence.reference.type,
				contexts: []
			}
			candidate.contexts = uniqueStrings([
				...candidate.contexts,
				combineContent([
					occurrence.claim.content,
					...occurrence.claim.evidence.map(({ excerpt }) => excerpt)
				])
			])
			candidates.set(key, candidate)
			byReference.set(occurrence.referenceId, candidate)
		}
		return { candidates, byReference }
	}

	const applySessionCandidateResolutions = (
		provisional: EntityReferenceOccurrence[],
		byReference: Map<string, SessionEntityCandidate>,
		resolutions: Map<string, EntityResolution>
	) => {
		for (const occurrence of provisional) {
			const candidate = byReference.get(occurrence.referenceId)
			if (!candidate) continue
			resolutions.set(occurrence.referenceId, {
				kind: 'session',
				reference: occurrence.reference,
				candidate,
				method: 'deterministic'
			})
		}
	}

	const applyModelResolutions = (
		requests: ModelResolutionRequest[],
		decisions: EntityIdentityDecision[],
		documents: VaultDocument[],
		sessionCandidatesByReference: Map<string, SessionEntityCandidate>,
		resolutions: Map<string, EntityResolution>
	) => {
		const decisionsByReference = new Map<string, EntityIdentityDecision[]>()
		for (const decision of decisions) {
			const existing = decisionsByReference.get(decision.referenceId) ?? []
			existing.push(decision)
			decisionsByReference.set(decision.referenceId, existing)
		}
		for (const request of requests) {
			const matchingDecisions = decisionsByReference.get(request.occurrence.referenceId)
			if (matchingDecisions?.length !== 1) continue
			const [decision] = matchingDecisions
			if (decision.kind === 'existing') {
				const chosen = request.candidates.find(
					(candidate) => candidate.targetId === decision.targetId
				)
				if (!chosen) continue
				const chosenCandidate = chosen.candidate
				if ('documentId' in chosenCandidate) {
					const document = documents.find(({ id }) => id === chosenCandidate.documentId)
					if (!document?.currentRevisionId) continue
					resolutions.set(request.occurrence.referenceId, {
						kind: 'existing',
						reference: request.occurrence.reference,
						document: document as VaultDocument & { currentRevisionId: string },
						method: 'model'
					})
				} else {
					resolutions.set(request.occurrence.referenceId, {
						kind: 'session',
						reference: request.occurrence.reference,
						candidate: chosenCandidate,
						method: 'model'
					})
				}
				continue
			}
			if (decision.kind === 'none-of-these') {
				if (!canCreateOccurrence(request.occurrence)) continue
				const candidate = sessionCandidatesByReference.get(request.occurrence.referenceId)
				if (!candidate) continue
				resolutions.set(request.occurrence.referenceId, {
					kind: 'session',
					reference: request.occurrence.reference,
					candidate,
					method: 'model'
				})
				continue
			}
			const candidateIds = uniqueStrings(decision.candidateIds)
			if (!candidateIds.length) {
				resolutions.set(request.occurrence.referenceId, {
					kind: 'unresolved',
					reference: request.occurrence.reference,
					match: {
						kind: 'unresolved',
						candidates: request.candidates.flatMap(({ candidate, provenance }) =>
							provenance !== 'relational-context' && 'documentId' in candidate ? [candidate] : []
						)
					},
					canCreate: canCreateOccurrence(request.occurrence)
				})
				continue
			}
			const deferred = candidateIds.flatMap((targetId) => {
				const candidate = request.candidates.find(
					(candidate) =>
						candidate.targetId === targetId &&
						candidate.provenance !== 'relational-context' &&
						candidate.provenance !== 'session-entity' &&
						'documentId' in candidate.candidate
				)
				return candidate && 'documentId' in candidate.candidate ? [candidate.candidate] : []
			})
			if (deferred.length < 1 || deferred.length !== candidateIds.length) continue
			resolutions.set(request.occurrence.referenceId, {
				kind: 'unresolved',
				reference: request.occurrence.reference,
				match: { kind: 'unresolved', candidates: deferred },
				canCreate: canCreateOccurrence(request.occurrence)
			})
		}
	}

	const applyUnresolvedResolutions = (
		requests: ModelResolutionRequest[],
		sessionCandidatesByReference: Map<string, SessionEntityCandidate>,
		resolutions: Map<string, EntityResolution>
	) => {
		for (const request of requests) {
			if (resolutions.has(request.occurrence.referenceId)) continue
			const deferred = request.candidates.flatMap(({ candidate, provenance }) =>
				provenance !== 'relational-context' &&
				provenance !== 'session-entity' &&
				'documentId' in candidate
					? [candidate]
					: []
			)
			if (deferred.length > 0) {
				resolutions.set(request.occurrence.referenceId, {
					kind: 'unresolved',
					reference: request.occurrence.reference,
					match: { kind: 'unresolved', candidates: deferred },
					canCreate: canCreateOccurrence(request.occurrence)
				})
				continue
			}
			const candidate = sessionCandidatesByReference.get(request.occurrence.referenceId)
			if (canCreateOccurrence(request.occurrence) && candidate) {
				resolutions.set(request.occurrence.referenceId, {
					kind: 'session',
					reference: request.occurrence.reference,
					candidate,
					method: request.candidates.length ? 'model' : 'deterministic'
				})
				continue
			}
			resolutions.set(request.occurrence.referenceId, {
				kind: 'unresolved',
				reference: request.occurrence.reference,
				match: { kind: 'unresolved', candidates: [] },
				canCreate: false
			})
		}
	}

	const attachResolutionsToClaims = (
		claims: ValidatedClaim[],
		occurrences: EntityReferenceOccurrence[],
		resolutions: Map<string, EntityResolution>
	): ResolvedClaim[] =>
		claims.map((claim) => ({
			...claim,
			entities: occurrences
				.filter(
					(occurrence) =>
						occurrence.claim.claimId === claim.claimId && occurrence.purpose === 'entity-reference'
				)
				.map((occurrence) => resolutions.get(occurrence.referenceId))
				.filter((entity): entity is EntityResolution => Boolean(entity)),
			event: occurrences
				.filter(
					(occurrence) =>
						occurrence.claim.claimId === claim.claimId && occurrence.purpose === 'development-event'
				)
				.map((occurrence) => resolutions.get(occurrence.referenceId))
				.find((entity): entity is EntityResolution => Boolean(entity))
		}))

	const resolveClaims = (claims: ValidatedClaim[], documents: VaultDocument[]) => {
		const occurrences = createEntityReferenceOccurrences(claims, documents)
		const resolutions = resolveExactOccurrences(occurrences, documents)
		const creatable = creatableSessionOccurrences(unresolvedOccurrences(occurrences, resolutions))
		const sessionCandidates = buildSessionCandidates(creatable)
		const automaticCreates = creatable.filter(
			(occurrence) =>
				occurrence.match.kind === 'unresolved' && occurrence.match.candidates.length === 0
		)
		applySessionCandidateResolutions(automaticCreates, sessionCandidates.byReference, resolutions)
		const modelRequests = retrieveEntityCandidates(
			occurrences,
			resolutions,
			documents,
			sessionCandidates.candidates,
			sessionCandidates.byReference
		)
		const requestsWithCandidates = modelRequests.filter(({ candidates }) => candidates.length > 0)
		const decisions = requestsWithCandidates.length
			? judgeEntityIdentity(
					ai,
					requestsWithCandidates.map(({ occurrence, context, candidates }) => ({
						referenceId: occurrence.referenceId,
						reference: occurrence.reference.label,
						type: occurrence.reference.type,
						evidence: context,
						candidates: candidates.map(({ targetId, title, type, context, provenance }) => ({
							targetId,
							title,
							type,
							context,
							provenance
						}))
					}))
				)
			: succeed([])

		return pipe(
			decisions,
			map((modelDecisions) => {
				applyModelResolutions(
					requestsWithCandidates,
					modelDecisions,
					documents,
					sessionCandidates.byReference,
					resolutions
				)
				applyUnresolvedResolutions(modelRequests, sessionCandidates.byReference, resolutions)
				return attachResolutionsToClaims(claims, occurrences, resolutions)
			})
		)
	}
	return { resolveClaims }
}
