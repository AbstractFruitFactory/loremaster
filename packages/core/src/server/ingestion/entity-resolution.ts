import { randomUUID } from 'node:crypto'
import { map, succeed } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiProvider } from '../ai/provider.js'
import type { VaultDocument } from '../vault/types.js'
import { contextualCandidates, identityCandidates, matchDocument } from './matching.js'
import type {
	EntityReferenceOccurrence,
	EntityResolution,
	ModelResolutionRequest,
	ResolutionCandidate,
	ResolvedClaim,
	SessionEntityCandidate,
	ValidatedClaim
} from './internal.js'
import type { SessionEntityResolution } from './types.js'
import {
	canCreateEntityFromReference,
	candidateContext,
	sessionCandidateTitle
} from './proposals.js'
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

	const existingResolutionCandidates = (
		occurrence: EntityReferenceOccurrence,
		context: string,
		documents: VaultDocument[]
	): ResolutionCandidate[] => {
		const candidates = new Map<string, ResolutionCandidate>()
		for (const identity of identityCandidates(
			occurrence.reference.label,
			documents,
			occurrence.reference.type
		)) {
			const { candidate, provenance } = identity
			const document = documents.find(({ id }) => id === candidate.documentId)
			if (!document) continue
			candidates.set(candidate.documentId, {
				targetId: `document:${candidate.documentId}`,
				title: candidate.title,
				type: occurrence.reference.type,
				context: candidateContext(document),
				provenance,
				candidate
			})
		}
		if (!canCreateOccurrence(occurrence)) {
			for (const candidate of contextualCandidates(
				occurrence.reference.label,
				context,
				documents,
				occurrence.reference.type
			)) {
				if (candidates.has(candidate.documentId)) continue
				const document = documents.find(({ id }) => id === candidate.documentId)
				if (!document) continue
				candidates.set(candidate.documentId, {
					targetId: `document:${candidate.documentId}`,
					title: candidate.title,
					type: occurrence.reference.type,
					context: candidateContext(document),
					provenance: 'relational-context',
					candidate
				})
			}
		}
		return [...candidates.values()].slice(0, 10)
	}

	const buildModelResolutionRequests = (
		occurrences: EntityReferenceOccurrence[],
		resolutions: Map<string, EntityResolution>,
		documents: VaultDocument[]
	): ModelResolutionRequest[] =>
		unresolvedOccurrences(occurrences, resolutions).map((occurrence) => {
			const context = combineContent([
				occurrence.claim.content,
				...occurrence.claim.evidence.map(({ excerpt }) => excerpt)
			])
			return {
				occurrence,
				context,
				candidates: existingResolutionCandidates(occurrence, context, documents)
			}
		})

	const resolutionPrompt = (requests: ModelResolutionRequest[]) =>
		JSON.stringify(
			{
				references: requests.map(({ occurrence, context, candidates }) => ({
					referenceId: occurrence.referenceId,
					reference: occurrence.reference.label,
					type: occurrence.reference.type,
					evidence: context,
					candidates: candidates.map(
						({ targetId, title, type, context: candidateText, provenance }) => ({
							targetId,
							title,
							type,
							provenance,
							context: candidateText
						})
					)
				}))
			},
			null,
			2
		)

	const applyModelResolutions = (
		requests: ModelResolutionRequest[],
		decisions: SessionEntityResolution[],
		documents: VaultDocument[],
		sessionCandidatesByReference: Map<string, SessionEntityCandidate>,
		resolutions: Map<string, EntityResolution>
	) => {
		const decisionsByReference = new Map<string, SessionEntityResolution[]>()
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
				const document = documents.find(({ id }) => id === chosen.candidate.documentId)
				if (!document?.currentRevisionId) continue
				resolutions.set(request.occurrence.referenceId, {
					kind: 'existing',
					reference: request.occurrence.reference,
					document: document as VaultDocument & { currentRevisionId: string },
					method: 'model'
				})
				continue
			}
			if (decision.kind === 'create') {
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
			const deferred = candidateIds.flatMap((targetId) => {
				const candidate = request.candidates.find(
					(candidate) =>
						candidate.targetId === targetId && candidate.provenance !== 'relational-context'
				)
				return candidate ? [candidate.candidate] : []
			})
			if (deferred.length < 2 || deferred.length !== candidateIds.length) continue
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
		const modelRequests = buildModelResolutionRequests(occurrences, resolutions, documents)
		const requestsWithCandidates = modelRequests.filter(({ candidates }) => candidates.length > 0)
		const decisions = requestsWithCandidates.length
			? ai.resolveSessionEntities({
					model: ai.analysisModel,
					system:
						'Resolve entity identity conservatively and return exactly one explicit outcome per reference. Use existing only when the supplied evidence and candidate context establish that the reference is the same campaign entity as that supplied target. A relational-context candidate may establish an existing target for a phrase such as "Elias\' father", but relational context alone is never a reason to defer to the user. Use create when the evidence describes a new named entity or event and none of the supplied identity candidates is the same thing. Use defer only when at least two supplied exact-name, alias, or partial-name candidates remain genuinely plausible identities; include only their supplied IDs and explain the ambiguity. Never defer relational-context candidates, invent a target, or return an ID that was not supplied.',
					prompt: resolutionPrompt(requestsWithCandidates)
				})
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
