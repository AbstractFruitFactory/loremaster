import { randomUUID } from 'node:crypto'
import { map, succeed } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { AiProvider } from '../ai/provider.js'
import type { VaultDocument } from '../vault/types.js'
import { contextualCandidates, matchDocument } from './matching.js'
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
		claims.flatMap((claim) =>
			claim.entityReferences.map((reference) => ({
				referenceId: randomUUID(),
				claim,
				reference,
				match: matchDocument(reference.label, documents, reference.type)
			}))
		)

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

	const provisionalSessionOccurrences = (occurrences: EntityReferenceOccurrence[]) =>
		occurrences.filter(
			(occurrence) =>
				occurrence.match.kind === 'unresolved' &&
				occurrence.match.candidates.length === 0 &&
				canCreateEntityFromReference(occurrence.reference)
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
	): ResolutionCandidate[] =>
		contextualCandidates(
			occurrence.reference.label,
			context,
			documents,
			occurrence.reference.type
		).flatMap((candidate) => {
			const document = documents.find(({ id }) => id === candidate.documentId)
			return document
				? [
						{
							targetId: `document:${candidate.documentId}`,
							title: candidate.title,
							type: occurrence.reference.type,
							context: candidateContext(document),
							candidate
						}
					]
				: []
		})

	const sessionResolutionCandidates = (
		occurrence: EntityReferenceOccurrence,
		sessionCandidates: Map<string, SessionEntityCandidate>
	): ResolutionCandidate[] =>
		[...sessionCandidates.values()]
			.filter(({ type }) => type === occurrence.reference.type)
			.map((candidate) => ({
				targetId: candidate.targetId,
				title: candidate.title,
				type: candidate.type,
				context: candidate.contexts.join('\n\n').slice(0, 1_600),
				candidate
			}))

	const buildModelResolutionRequests = (
		occurrences: EntityReferenceOccurrence[],
		resolutions: Map<string, EntityResolution>,
		documents: VaultDocument[],
		sessionCandidates: Map<string, SessionEntityCandidate>
	): ModelResolutionRequest[] =>
		unresolvedOccurrences(occurrences, resolutions).map((occurrence) => {
			const context = combineContent([
				occurrence.claim.content,
				...occurrence.claim.evidence.map(({ excerpt }) => excerpt)
			])
			return {
				occurrence,
				context,
				candidates: [
					...existingResolutionCandidates(occurrence, context, documents),
					...sessionResolutionCandidates(occurrence, sessionCandidates)
				].slice(0, 10)
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
					candidates: candidates.map(({ targetId, title, type, context: candidateText }) => ({
						targetId,
						title,
						type,
						context: candidateText
					}))
				}))
			},
			null,
			2
		)

	const applyModelResolutions = (
		requests: ModelResolutionRequest[],
		decisions: SessionEntityResolution[],
		documents: VaultDocument[],
		resolutions: Map<string, EntityResolution>
	) => {
		const decisionByReference = new Map(
			decisions.map((decision) => [decision.referenceId, decision.targetId])
		)
		for (const request of requests) {
			const targetId = decisionByReference.get(request.occurrence.referenceId)
			if (!targetId) continue
			const chosen = request.candidates.find((candidate) => candidate.targetId === targetId)
			if (!chosen) continue
			const candidate = chosen.candidate
			if ('documentId' in candidate) {
				const document = documents.find(({ id }) => id === candidate.documentId)
				if (!document?.currentRevisionId) continue
				resolutions.set(request.occurrence.referenceId, {
					kind: 'existing',
					reference: request.occurrence.reference,
					document: document as VaultDocument & { currentRevisionId: string },
					method: 'model'
				})
				continue
			}
			resolutions.set(request.occurrence.referenceId, {
				kind: 'session',
				reference: request.occurrence.reference,
				candidate,
				method: 'model'
			})
		}
	}

	const applyUnresolvedResolutions = (
		requests: ModelResolutionRequest[],
		resolutions: Map<string, EntityResolution>
	) => {
		for (const request of requests) {
			if (resolutions.has(request.occurrence.referenceId)) continue
			const candidates = request.candidates.flatMap(({ candidate }) =>
				'documentId' in candidate ? [candidate] : []
			)
			resolutions.set(request.occurrence.referenceId, {
				kind: 'unresolved',
				reference: request.occurrence.reference,
				match: { kind: 'unresolved', candidates },
				canCreate: canCreateEntityFromReference(request.occurrence.reference)
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
				.filter((occurrence) => occurrence.claim.claimId === claim.claimId)
				.map((occurrence) => resolutions.get(occurrence.referenceId))
				.filter((entity): entity is EntityResolution => Boolean(entity))
		}))

	const resolveClaims = (claims: ValidatedClaim[], documents: VaultDocument[]) => {
		const occurrences = createEntityReferenceOccurrences(claims, documents)
		const resolutions = resolveExactOccurrences(occurrences, documents)
		const provisional = provisionalSessionOccurrences(
			unresolvedOccurrences(occurrences, resolutions)
		)
		const sessionCandidates = buildSessionCandidates(provisional)
		applySessionCandidateResolutions(provisional, sessionCandidates.byReference, resolutions)
		const modelRequests = buildModelResolutionRequests(
			occurrences,
			resolutions,
			documents,
			sessionCandidates.candidates
		)
		const requestsWithCandidates = modelRequests.filter(({ candidates }) => candidates.length > 0)
		const decisions = requestsWithCandidates.length
			? ai.resolveSessionEntities({
					model: ai.analysisModel,
					system:
						'Resolve entity references conservatively. For each reference, choose a targetId only when the supplied evidence and candidate context establish that they are the same campaign entity. A relational phrase such as "Elias\' father" may resolve through an established relationship. Do not choose by plausibility alone. Never invent a target or return an ID that was not supplied. Return null when identity is not established.',
					prompt: resolutionPrompt(requestsWithCandidates)
				})
			: succeed([])

		return pipe(
			decisions,
			map((modelDecisions) => {
				applyModelResolutions(requestsWithCandidates, modelDecisions, documents, resolutions)
				applyUnresolvedResolutions(modelRequests, resolutions)
				return attachResolutionsToClaims(claims, occurrences, resolutions)
			})
		)
	}
	return { resolveClaims }
}
