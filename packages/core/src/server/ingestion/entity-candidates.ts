import type { VaultDocument } from '../vault/types.js'
import type {
	EntityReferenceOccurrence,
	EntityResolution,
	ModelResolutionRequest,
	ResolutionCandidate,
	SessionEntityCandidate
} from './internal.js'
import { contextualCandidates, identityCandidates } from './matching.js'
import { canCreateEntityFromReference, candidateContext } from './proposals.js'
import { combineContent } from './text.js'

const canCreateOccurrence = (occurrence: EntityReferenceOccurrence) =>
	occurrence.purpose === 'development-event' || canCreateEntityFromReference(occurrence.reference)

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

const sessionResolutionCandidates = (
	occurrence: EntityReferenceOccurrence,
	sessionCandidates: Map<string, SessionEntityCandidate>,
	sessionCandidatesByReference: Map<string, SessionEntityCandidate>
): ResolutionCandidate[] => {
	const ownCandidate = sessionCandidatesByReference.get(occurrence.referenceId)
	return [...sessionCandidates.values()]
		.filter(
			(candidate) =>
				candidate.type === occurrence.reference.type &&
				candidate.targetId !== ownCandidate?.targetId
		)
		.map((candidate) => ({
			targetId: candidate.targetId,
			title: candidate.title,
			type: candidate.type,
			context: candidate.contexts.join('\n\n').slice(0, 1_600),
			provenance: 'session-entity' as const,
			candidate
		}))
}

export const retrieveEntityCandidates = (
	occurrences: EntityReferenceOccurrence[],
	resolutions: Map<string, EntityResolution>,
	documents: VaultDocument[],
	sessionCandidates: Map<string, SessionEntityCandidate>,
	sessionCandidatesByReference: Map<string, SessionEntityCandidate>
): ModelResolutionRequest[] =>
	occurrences
		.filter(({ referenceId }) => !resolutions.has(referenceId))
		.map((occurrence) => {
			const context = combineContent([
				occurrence.claim.content,
				...occurrence.claim.evidence.map(({ excerpt }) => excerpt)
			])
			const existing = existingResolutionCandidates(occurrence, context, documents)
			return {
				occurrence,
				context,
				candidates: [
					...existing.filter(({ provenance }) => provenance !== 'relational-context'),
					...sessionResolutionCandidates(
						occurrence,
						sessionCandidates,
						sessionCandidatesByReference
					),
					...existing.filter(({ provenance }) => provenance === 'relational-context')
				].slice(0, 10)
			}
		})
