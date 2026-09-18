import type { SessionEventAudit } from './types.js'
import type { ValidatedClaim } from './internal.js'
import { normalize, uniqueEntityReferences, uniqueEvidence, uniqueStrings } from './text.js'

const normalizedClaimKey = (claim: ValidatedClaim) =>
	JSON.stringify([
		claim.kind,
		normalize(claim.content),
		claim.entityReferences.map(({ label, type, role }) => [type, normalize(label), role])
	])

export const mergeClaims = (claims: ValidatedClaim[]) => {
	const merged = new Map<string, ValidatedClaim>()
	for (const claim of claims) {
		const key = normalizedClaimKey(claim)
		const existing = merged.get(key)
		if (existing) {
			existing.evidence = uniqueEvidence([...existing.evidence, ...claim.evidence])
			existing.entityReferences = uniqueEntityReferences([
				...existing.entityReferences,
				...claim.entityReferences
			])
			if (claim.certainty === 'inferred') existing.certainty = 'inferred'
		} else merged.set(key, { ...claim, evidence: [...claim.evidence] })
	}
	return [...merged.values()]
}

export const reconcileEventClaims = (
	claims: ValidatedClaim[],
	audit: SessionEventAudit,
	auditedEvents: ValidatedClaim[]
) => {
	const eventClaims = new Map(
		claims.filter(({ kind }) => kind === 'development').map((claim) => [claim.claimId, claim])
	)
	const warnings: string[] = []
	const discarded = new Set<string>()

	for (const decision of audit.discardedEventIds) {
		if (!eventClaims.has(decision.eventId)) {
			warnings.push(
				`Event audit decision discarded [invalid-reference] ${JSON.stringify(decision)}`
			)
			continue
		}
		discarded.add(decision.eventId)
		warnings.push(
			`Event discarded by audit ${JSON.stringify({ eventId: decision.eventId, reason: decision.reason })}`
		)
	}

	for (const group of audit.duplicateGroups) {
		const canonical = eventClaims.get(group.canonicalEventId)
		const duplicateIds = uniqueStrings(group.duplicateEventIds).filter(
			(eventId) => eventId !== group.canonicalEventId
		)
		const duplicates = duplicateIds.flatMap((eventId) => {
			const claim = eventClaims.get(eventId)
			return claim ? [claim] : []
		})
		if (
			!canonical ||
			discarded.has(group.canonicalEventId) ||
			duplicates.length !== duplicateIds.length ||
			duplicateIds.some((eventId) => discarded.has(eventId))
		) {
			warnings.push(`Event duplicate group discarded [invalid-reference] ${JSON.stringify(group)}`)
			continue
		}

		canonical.evidence = uniqueEvidence([
			...canonical.evidence,
			...duplicates.flatMap(({ evidence }) => evidence)
		])
		canonical.entityReferences = uniqueEntityReferences([
			...canonical.entityReferences,
			...duplicates.flatMap(({ entityReferences }) => entityReferences)
		])
		if (duplicates.some(({ certainty }) => certainty === 'inferred'))
			canonical.certainty = 'inferred'
		for (const eventId of duplicateIds) discarded.add(eventId)
	}

	return {
		claims: [
			...claims.filter(({ kind, claimId }) => kind !== 'development' || !discarded.has(claimId)),
			...auditedEvents
		],
		warnings
	}
}
