import type { VaultDocument } from '../vault/types.js'
import type {
	EntityReferenceOccurrence,
	EntityResolution,
	ResolvedClaim,
	ValidatedClaim
} from './internal.js'
import { identityCandidates } from './matching.js'
import { canCreateEntityFromReference, sessionCandidateTitle } from './proposals.js'
import { displayTitle, normalize } from './text.js'

const canCreateOccurrence = (occurrence: EntityReferenceOccurrence) =>
	occurrence.purpose === 'development-event' || canCreateEntityFromReference(occurrence.reference)

const occurrencesFor = (claims: ValidatedClaim[]): EntityReferenceOccurrence[] =>
	claims.flatMap((claim) => [
		...claim.entityReferences.map((reference, index) => ({
			referenceId: `${claim.claimId}:entity:${index}`,
			purpose: 'entity-reference' as const,
			claim,
			reference,
			match: { kind: 'unresolved' as const, candidates: [] }
		})),
		...(claim.kind === 'development' && claim.eventTitle
			? [
					{
						referenceId: `${claim.claimId}:event`,
						purpose: 'development-event' as const,
						claim,
						reference: {
							label: claim.eventTitle,
							type: 'event' as const,
							role: 'subject' as const
						},
						match: { kind: 'unresolved' as const, candidates: [] }
					}
				]
			: [])
	])

export const resolveCampaignImportClaims = (
	claims: ValidatedClaim[],
	documents: VaultDocument[]
): ResolvedClaim[] => {
	const occurrences = occurrencesFor(claims)
	const resolutions = new Map<string, EntityResolution>()
	for (const occurrence of occurrences) {
		const candidates = identityCandidates(
			occurrence.reference.label,
			documents,
			occurrence.reference.type
		).map(({ candidate }) => candidate)
		if (candidates.length) {
			resolutions.set(occurrence.referenceId, {
				kind: 'unresolved',
				reference: occurrence.reference,
				match: { kind: 'unresolved', candidates },
				canCreate: canCreateOccurrence(occurrence)
			})
			continue
		}
		if (canCreateOccurrence(occurrence)) {
			const title =
				occurrence.purpose === 'development-event'
					? occurrence.reference.label
					: (sessionCandidateTitle(occurrence, occurrences) ?? occurrence.reference.label)
			resolutions.set(occurrence.referenceId, {
				kind: 'session',
				reference: occurrence.reference,
				candidate: {
					targetId: `import:${occurrence.reference.type}:${normalize(title)}`,
					title: displayTitle(title),
					type: occurrence.reference.type,
					contexts: [occurrence.claim.content]
				},
				method: 'deterministic'
			})
			continue
		}
		resolutions.set(occurrence.referenceId, {
			kind: 'unresolved',
			reference: occurrence.reference,
			match: { kind: 'unresolved', candidates: [] },
			canCreate: false
		})
	}
	return claims.map((claim) => ({
		...claim,
		entities: occurrences
			.filter(
				(occurrence) =>
					occurrence.claim.claimId === claim.claimId && occurrence.purpose === 'entity-reference'
			)
			.map((occurrence) => resolutions.get(occurrence.referenceId)!)
			.filter(Boolean),
		event: occurrences
			.filter(
				(occurrence) =>
					occurrence.claim.claimId === claim.claimId && occurrence.purpose === 'development-event'
			)
			.map((occurrence) => resolutions.get(occurrence.referenceId))
			.find((resolution): resolution is EntityResolution => Boolean(resolution))
	}))
}
