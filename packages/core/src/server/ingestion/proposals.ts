import { randomUUID } from 'node:crypto'
import type { VaultDocument } from '../vault/types.js'
import type {
	EntityReference,
	ExtractedSessionClaim,
	ProposalCandidate,
	ProposalMatch,
	SessionProposal
} from './types.js'
import type { EntityReferenceOccurrence, EntityResolution, ResolvedClaim } from './internal.js'
import {
	combineContent,
	displayTitle,
	normalize,
	uniqueEvidence,
	uniqueReferences,
	uniqueStrings,
	wordTokens
} from './text.js'

export const canCreateEntityFromReference = (reference: EntityReference) => {
	if (reference.type === 'event') return false
	const value = reference.label.trim()
	if (!value || value.length > 80) return false
	if (/\p{L}['’](?:s\b|\s)/iu.test(value)) return false
	if (/^(?:his|her|their|its|my|your|our|someone|somebody|something)\b/iu.test(value)) return false
	return true
}

const tokenSubset = (left: string, right: string) => {
	const leftTokens = new Set(wordTokens(left))
	const rightTokens = new Set(wordTokens(right))
	return leftTokens.size > 0 && [...leftTokens].every((token) => rightTokens.has(token))
}

export const sessionCandidateTitle = (
	occurrence: EntityReferenceOccurrence,
	provisional: EntityReferenceOccurrence[]
): string | undefined => {
	const compatible = provisional.filter(
		(candidate) =>
			candidate.reference.type === occurrence.reference.type &&
			tokenSubset(occurrence.reference.label, candidate.reference.label)
	)
	if (!compatible.length) return undefined
	const maxTokens = Math.max(
		...compatible.map(({ reference }) => wordTokens(reference.label).length)
	)
	const strongest = uniqueStrings(
		compatible
			.filter(({ reference }) => wordTokens(reference.label).length === maxTokens)
			.map(({ reference }) => reference.label)
	)
	return strongest.length === 1 ? strongest[0] : undefined
}

export const candidateContext = (document: VaultDocument) =>
	[document.summary, document.content].filter(Boolean).join('\n').slice(0, 1_600)

const eventTitle = ({ eventTitle }: Pick<ExtractedSessionClaim, 'eventTitle'>) => {
	if (!eventTitle) throw new Error('Development claim is missing an event title')
	return eventTitle
}

const recordTitle = (content: string) => {
	const value = content.trim().replace(/\s+/g, ' ')
	return value.length > 80 ? `${value.slice(0, 77)}…` : value || 'Session knowledge'
}

const matchForExisting = (document: VaultDocument): ProposalMatch => ({
	kind: 'exact',
	documentId: document.id,
	title: document.title,
	documentType: document.type
})

const referencesFor = (entities: EntityResolution[]) =>
	uniqueReferences(
		entities.map((entity) => {
			if (entity.kind === 'existing') {
				return { label: entity.reference.label, documentId: entity.document.id }
			}
			if (entity.kind === 'session') {
				return { label: entity.reference.label }
			}
			return { label: entity.reference.label }
		})
	)

const mentionProposal = (
	claim: ResolvedClaim,
	references: SessionProposal['references']
): SessionProposal => {
	const first =
		claim.entities.find(({ reference }) => reference.role === 'subject') ?? claim.entities[0]
	const match: ProposalMatch =
		first?.kind === 'existing'
			? matchForExisting(first.document)
			: first?.kind === 'unresolved'
				? first.match
				: { kind: 'unresolved', candidates: [] }
	return {
		proposalId: randomUUID(),
		claimIds: [claim.claimId],
		operation: 'mention-only',
		documentType: first?.reference.type ?? 'worldbuilding',
		title: first?.reference.label ?? recordTitle(claim.content),
		certainty: claim.certainty,
		selected: false,
		evidence: claim.evidence,
		match,
		references,
		content: claim.content
	}
}

const updateEntityProposal = (
	claim: ResolvedClaim,
	entity: Extract<EntityResolution, { kind: 'existing' }>,
	references: SessionProposal['references']
): SessionProposal => ({
	proposalId: randomUUID(),
	claimIds: [claim.claimId],
	operation: 'update-canon',
	documentType: entity.document.type,
	title: entity.document.title,
	certainty: claim.certainty,
	selected: claim.certainty === 'explicit' && entity.method === 'deterministic',
	evidence: claim.evidence,
	match: matchForExisting(entity.document),
	references,
	content: claim.content,
	resolutionMethod: entity.method,
	base: {
		documentId: entity.document.id,
		revisionId: entity.document.currentRevisionId
	},
	patch: { kind: 'append', content: claim.content }
})

const createSessionEntityProposal = (
	claim: ResolvedClaim,
	entity: Extract<EntityResolution, { kind: 'session' }>,
	references: SessionProposal['references']
): SessionProposal => ({
	proposalId: randomUUID(),
	claimIds: [claim.claimId],
	operation: 'create-entity',
	documentType: entity.candidate.type,
	title: entity.candidate.title,
	certainty: claim.certainty,
	selected: claim.certainty === 'explicit' && entity.method === 'deterministic',
	evidence: claim.evidence,
	match: { kind: 'unresolved', candidates: [] },
	references,
	content: claim.content,
	resolutionMethod: entity.method,
	canCreate: true
})

const unresolvedEntityProposal = (
	claim: ResolvedClaim,
	entity: Extract<EntityResolution, { kind: 'unresolved' }>,
	references: SessionProposal['references']
): SessionProposal | undefined =>
	entity.match.candidates.length
		? {
				proposalId: randomUUID(),
				claimIds: [claim.claimId],
				operation: 'create-entity',
				documentType: entity.reference.type,
				title: displayTitle(entity.reference.label),
				certainty: claim.certainty,
				selected: false,
				evidence: claim.evidence,
				match: entity.match,
				references,
				content: claim.content,
				canCreate: entity.canCreate
			}
		: undefined

const developmentProposal = (
	claim: ResolvedClaim,
	references: SessionProposal['references']
): SessionProposal => {
	const event = claim.event
	if (event?.kind === 'existing') return updateEntityProposal(claim, event, references)
	const title = event?.kind === 'session' ? event.candidate.title : eventTitle(claim)
	const match =
		event?.kind === 'unresolved' ? event.match : { kind: 'unresolved' as const, candidates: [] }
	const resolutionMethod = event?.kind === 'session' ? event.method : undefined
	return {
		proposalId: randomUUID(),
		claimIds: [claim.claimId],
		operation: 'create-event',
		documentType: 'event',
		title,
		certainty: claim.certainty,
		selected:
			claim.certainty === 'explicit' &&
			match.candidates.length === 0 &&
			resolutionMethod !== 'model',
		evidence: claim.evidence,
		match,
		references,
		content: claim.content,
		resolutionMethod,
		canCreate: true
	}
}

const recordOnlyProposal = (
	claim: ResolvedClaim,
	references: SessionProposal['references']
): SessionProposal => ({
	proposalId: randomUUID(),
	claimIds: [claim.claimId],
	operation: 'record-only',
	documentType: 'worldbuilding',
	title: recordTitle(claim.content),
	certainty: claim.certainty,
	selected: claim.certainty === 'explicit',
	evidence: claim.evidence,
	match: { kind: 'unresolved', candidates: [] },
	references,
	content: claim.content
})

const stableFactProposals = (
	claim: ResolvedClaim,
	references: SessionProposal['references']
): SessionProposal[] => {
	const proposals = claim.entities
		.filter(({ reference }) => reference.role === 'subject')
		.flatMap((entity) => {
			if (entity.kind === 'existing') {
				return [updateEntityProposal(claim, entity, references)]
			}
			if (entity.kind === 'session') {
				return [createSessionEntityProposal(claim, entity, references)]
			}
			const proposal = unresolvedEntityProposal(claim, entity, references)
			return proposal ? [proposal] : []
		})
	return proposals.length ? proposals : [recordOnlyProposal(claim, references)]
}

export const proposalsForClaim = (claim: ResolvedClaim): SessionProposal[] => {
	const references = referencesFor(claim.entities)
	if (claim.kind === 'mention') return [mentionProposal(claim, references)]
	if (claim.kind === 'development') return [developmentProposal(claim, references)]
	return stableFactProposals(claim, references)
}

const proposalGroupKey = (proposal: SessionProposal) => {
	if (proposal.operation === 'update-canon' && proposal.base)
		return `update:${proposal.base.documentId}`
	if (
		proposal.operation === 'record-only' ||
		proposal.operation === 'mention-only' ||
		proposal.operation === 'create-event'
	) {
		return `${proposal.operation}:${proposal.claimIds.join(':')}`
	}
	return `${proposal.operation}:${proposal.documentType}:${normalize(proposal.title)}`
}

const mergedMatch = (left: ProposalMatch, right: ProposalMatch): ProposalMatch => {
	if (left.kind === 'exact') return left
	if (right.kind === 'exact') return right
	const candidates = new Map<string, ProposalCandidate>()
	for (const candidate of [...left.candidates, ...right.candidates]) {
		const existing = candidates.get(candidate.documentId)
		if (!existing || candidate.score > existing.score)
			candidates.set(candidate.documentId, candidate)
	}
	return {
		kind: 'unresolved',
		candidates: [...candidates.values()]
			.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
			.slice(0, 8)
	}
}

export const mergeProposals = (proposals: SessionProposal[]) => {
	const grouped = new Map<string, SessionProposal>()
	for (const proposal of proposals) {
		const groupId = proposalGroupKey(proposal)
		const existing = grouped.get(groupId)
		if (!existing) {
			grouped.set(groupId, { ...proposal, groupId })
			continue
		}

		const content = combineContent([existing.content, proposal.content])
		const certainty =
			existing.certainty === 'explicit' && proposal.certainty === 'explicit'
				? 'explicit'
				: 'inferred'
		const match = mergedMatch(existing.match, proposal.match)
		const hasPossibleMatches = match.kind === 'unresolved' && match.candidates.length > 0
		const resolutionMethod =
			existing.resolutionMethod === 'model' || proposal.resolutionMethod === 'model'
				? 'model'
				: (existing.resolutionMethod ?? proposal.resolutionMethod)
		grouped.set(groupId, {
			...existing,
			claimIds: uniqueStrings([...existing.claimIds, ...proposal.claimIds]),
			certainty,
			selected:
				certainty === 'explicit' &&
				existing.operation !== 'mention-only' &&
				!hasPossibleMatches &&
				resolutionMethod !== 'model',
			evidence: uniqueEvidence([...existing.evidence, ...proposal.evidence]),
			match,
			references: uniqueReferences([...existing.references, ...proposal.references]),
			content,
			resolutionMethod,
			canCreate: Boolean(existing.canCreate || proposal.canCreate),
			...(existing.patch ? { patch: { ...existing.patch, content } } : {})
		})
	}
	return [...grouped.values()]
}
