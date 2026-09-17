import { randomUUID } from 'node:crypto'
import { all, fail as failEffect, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { buildSessionRecap, canonicalDocumentContent } from '../../ingestion'
import type { AiProvider } from '../ai/provider'
import type { Failure } from '../failure'
import {
	temporalGraphProblem,
	temporalRelation,
	timelineRelation,
	topologicalLayers
} from '../timeline/graph'
import type { TimelineContainment, TimelineEdge } from '../timeline/types'
import type { VaultDocument } from '../vault/types'
import { chunkTranscript } from './chunking'
import { materializeEvidenceRanges } from './evidence'
import { contextualCandidates, matchDocument } from './matching'
import type { IngestionStorage } from './storage'
import type {
	EntityReference,
	Evidence,
	ExtractedSessionClaim,
	InferredSessionChronology,
	IngestionDocumentType,
	ProposalCandidate,
	ProposalMatch,
	SessionClaimEvidenceRepair,
	SessionClaimValidation,
	SessionChronologyCoverageProposal,
	SessionIngestionDraft,
	SessionChronologyProposal,
	SessionEntityResolution,
	SessionIngestionResult,
	SessionProposal,
	SessionProposalResolution,
	SessionEventAudit
} from './types'

const categoryDirectory: Record<VaultDocument['type'], string> = {
	player: 'Players',
	npc: 'NPCs',
	location: 'Locations',
	session: 'Sessions',
	item: 'Items',
	worldbuilding: 'Worldbuilding',
	event: 'Events'
}

const toSlug = (title: string) =>
	title
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-|-$/g, '') || 'document'

const normalize = (value: string) => value.trim().toLocaleLowerCase()

const displayTitle = (title: string) => {
	const value = title.trim().replace(/\s+/g, ' ')
	const firstLetter = value.match(/\p{L}/u)
	if (!firstLetter || firstLetter.index === undefined) return value
	const index = firstLetter.index
	const letter = firstLetter[0]
	return `${value.slice(0, index)}${letter.toLocaleUpperCase()}${value.slice(index + letter.length)}`
}

const wordTokens = (value: string) => normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []

const uniqueStrings = (values: string[]) => [
	...new Map(values.map((value) => [normalize(value), value])).values()
]

const uniqueEvidence = (evidence: Evidence[]) => [
	...new Map(
		evidence.map((item) => [`${item.startStringIndex}:${item.endStringIndex}`, item])
	).values()
]

const uniqueEntityReferences = (references: EntityReference[]) => [
	...new Map(
		references.map((reference) => [`${reference.type}:${normalize(reference.label)}`, reference])
	).values()
]

const entityReferenceId = (candidateId: string, index: number) =>
	`${candidateId}:reference-${index + 1}`

const uniqueReferences = (references: SessionProposal['references']) => [
	...new Map(
		references.map((reference) => [
			reference.documentId ? `id:${reference.documentId}` : `label:${normalize(reference.label)}`,
			reference
		])
	).values()
]

const combineContent = (contents: string[]) =>
	uniqueStrings(contents.map((content) => content.trim()).filter(Boolean)).join('\n\n')

type ValidatedClaim = Omit<ExtractedSessionClaim, 'evidence'> & {
	claimId: string
	evidence: Evidence[]
}

type EvidenceBackedClaim = {
	candidateId: string
	claimIndex: number
	claim: ExtractedSessionClaim
	evidence: Evidence[]
}

type SessionEntityCandidate = {
	targetId: string
	title: string
	type: IngestionDocumentType
	contexts: string[]
}

type EntityResolution =
	| {
			kind: 'existing'
			reference: EntityReference
			document: VaultDocument & { currentRevisionId: string }
			method: 'deterministic' | 'model'
	  }
	| {
			kind: 'session'
			reference: EntityReference
			candidate: SessionEntityCandidate
			method: 'deterministic' | 'model'
	  }
	| {
			kind: 'unresolved'
			reference: EntityReference
			match: { kind: 'unresolved'; candidates: ProposalCandidate[] }
			canCreate: boolean
	  }

type ResolvedClaim = ValidatedClaim & {
	entities: EntityResolution[]
}

type EntityReferenceOccurrence = {
	referenceId: string
	claim: ValidatedClaim
	reference: EntityReference
	match: ProposalMatch
}

type ResolutionCandidate = {
	targetId: string
	title: string
	type: IngestionDocumentType
	context: string
	candidate: ProposalCandidate | SessionEntityCandidate
}

type ModelResolutionRequest = {
	occurrence: EntityReferenceOccurrence
	context: string
	candidates: ResolutionCandidate[]
}

type TranscriptChunk = ReturnType<typeof chunkTranscript>[number]

type CommitInput = {
	campaignId: string
	ingestionId: string
	selectedProposalIds: string[]
	selectedChronologyIds?: string[]
	resolutions?: SessionProposalResolution[]
}

type PlannedMutation = {
	proposal: SessionProposal
	documentId: string
	path?: string
	after?: string[]
	during?: string[]
	eventForm?: VaultDocument['eventForm']
}

type MutationPlan = {
	planned: PlannedMutation[]
	chronologyUpdates: {
		documentId: string
		after: string[]
		during: string[]
		eventForm: VaultDocument['eventForm']
	}[]
	documentIdByProposal: Map<string, string>
	existingById: Map<string, VaultDocument>
	sessionDocumentId: string
}

const normalizedClaimKey = (claim: ValidatedClaim) =>
	JSON.stringify([
		claim.kind,
		normalize(claim.content),
		claim.entityReferences.map(({ label, type }) => [type, normalize(label)])
	])

const mergeClaims = (claims: ValidatedClaim[]) => {
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

const reconcileEventClaims = (
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

const canCreateEntityFromReference = (reference: EntityReference) => {
	if (reference.type === 'event') return false
	const value = reference.label.trim()
	if (!value || value.length > 80) return false
	if (/['’]s\b/iu.test(value)) return false
	if (/^(?:his|her|their|its|my|your|our|someone|somebody|something)\b/iu.test(value)) return false
	return true
}

const tokenSubset = (left: string, right: string) => {
	const leftTokens = new Set(wordTokens(left))
	const rightTokens = new Set(wordTokens(right))
	return leftTokens.size > 0 && [...leftTokens].every((token) => rightTokens.has(token))
}

const sessionCandidateTitle = (
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

const candidateContext = (document: VaultDocument) =>
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
	const first = claim.entities[0]
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

const developmentProposal = (
	claim: ResolvedClaim,
	references: SessionProposal['references']
): SessionProposal => ({
	proposalId: randomUUID(),
	claimIds: [claim.claimId],
	operation: 'create-event',
	documentType: 'event',
	title: eventTitle(claim),
	certainty: claim.certainty,
	selected: claim.certainty === 'explicit',
	evidence: claim.evidence,
	match: { kind: 'unresolved', candidates: [] },
	references,
	content: claim.content
})

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
	const proposals = claim.entities.flatMap((entity) => {
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

const proposalsForClaim = (claim: ResolvedClaim): SessionProposal[] => {
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
		candidates: [...candidates.values()].sort(
			(a, b) => b.score - a.score || a.title.localeCompare(b.title)
		)
	}
}

const mergeProposals = (proposals: SessionProposal[]) => {
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

export const sessionIngestion = ({
	ai,
	storage,
	vault
}: {
	ai: Pick<
		AiProvider,
		| 'analyzeSessionChunk'
		| 'validateSessionClaims'
		| 'repairSessionClaimEvidence'
		| 'resolveSessionEntities'
		| 'auditSessionEvents'
		| 'inferSessionChronology'
	> & {
		analysisModel: string
	}
	storage: IngestionStorage
	vault: {
		getDocuments: (campaignId: string) => Effect<VaultDocument[], Failure>
		createDocument: (
			campaignId: string,
			input: {
				documentId?: string
				path: string
				type: VaultDocument['type']
				after?: string[]
				during?: string[]
				eventForm?: VaultDocument['eventForm']
				content: string
				ingestionId?: string
				transcript?: string
				revision?: {
					source: 'ingestion'
					relatedSessionId: string
					ingestionId: string
					changeSummary: string
				}
			}
		) => Effect<VaultDocument, Failure>
		updateDocument: (
			campaignId: string,
			documentId: string,
			input: {
				type: VaultDocument['type']
				aliases?: string[]
				after?: string[]
				during?: string[]
				eventForm?: VaultDocument['eventForm']
				content: string
				expectedRevisionId: string
				revision?: {
					source: 'ingestion'
					relatedSessionId: string
					ingestionId: string
					changeSummary: string
				}
			}
		) => Effect<VaultDocument, Failure>
	}
}) => {
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

	const extractionSystem =
		'Extract atomic campaign claims from the numbered transcript. Claims describe evidence, not how campaign canon should be stored: do not invent document titles or choose destination documents. Every claim must cite one or more supporting line ranges from the numbered transcript. Cite the smallest set of ranges that collectively supports the full normalized claim. The cited evidence itself must establish every identity, attribution, relationship, chronology statement, and coreference expressed in the claim: if you normalize pronouns or contextual references such as "she", "her", "it", or "E. Vey" into a named entity, expand the range or cite additional ranges that establish that identity. Do not rely on uncited surrounding lines to justify a normalized identity. Use multiple ranges when a conversation or separated statements are needed. Entity references are semantic identifiers, not quotations: include each distinct campaign entity the claim is materially about, using the clearest concise name or contextual identifier supported by the cited evidence. Only emit entity references for durable campaign entities with independent identity; do not turn every noun, physical feature, or piece of scenery into an entity. Use worldbuilding for a persistent setting concept with its own identity that is not primarily a person, place, item, or event, such as a religion, myth, ritual, magical phenomenon or system, social custom, law, prophecy, calendar, or institution. Do not use worldbuilding as a catch-all for isolated facts without a coherent persistent subject. A location reference must denote a distinct, persistent place that the campaign could reasonably refer to again by identity. Ordinary scenery or architectural/spatial fragments such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor are not Locations merely because something happens there. A room, chamber, tunnel, district, building, region, or descriptively named place may be a Location when the evidence establishes it as a distinct persistent place. Scene or section headings are editorial structure, not canonical entity names or evidence that a place has that identity; never use a heading alone to create or name an entity. If a claim concerns an environmental detail inside a place but no distinct sub-location is established, omit that location reference rather than inventing one. Entity-reference labels that may become document titles must be display-ready canonical names. Preserve capitalization established by the campaign, including proper names and acronyms. When the evidence establishes a descriptive entity but not a canonical capitalization, format the label as a readable title rather than copying sentence casing; for example, emit \"Service Tunnels Below Cathedral Square\" rather than \"service tunnels below Cathedral Square\". Do not mechanically rewrite an explicitly established unusual name. Entity-reference labels do not need to occur verbatim in the cited lines, but do not resolve ambiguous identities by plausibility; for example, keep "E. Vey" rather than changing it to "Elias Vey" unless the cited evidence establishes they are the same person. Avoid incidental or speculative entity references. Mark interpretation as inferred and mere names as mentions. Treat durable changes such as captures, rescues, deaths, discoveries, openings, item transfers, ritual changes, and escapes or disappearances as developments. Never strengthen an uncertain outcome: disappeared does not mean escaped, fell does not mean died, an attempted action does not mean it succeeded, and an unresolved fate must remain unresolved. For every development claim, set eventTitle to a concise factual label suitable for a timeline or list: usually 3-8 words and under 60 characters. The title must summarize only the claim content and must not introduce new identity, motive, causality, chronology, outcome, or interpretation. Prefer plain labels such as "Empty Bell cracks", "Talven\'s body discovered", or "Saltwater draft in Weaver\'s Cut" rather than full sentences or dramatic prose. For stable-fact and mention claims, set eventTitle to null. Do not turn a property or topic into an entity: use "Mara", not "Mara\'s age".'
	const validationSystem =
		"Independently verify candidate campaign claims against their cited transcript evidence. Judge claim content separately from semantic entity-reference metadata. For each candidateId, accepted refers only to whether the cited evidence collectively supports the exact claim content. Always return a reason. Use supported only when accepted is true. When rejected, use insufficient-evidence only when the exact existing claim appears supportable from other lines in the supplied transcript chunk and could be grounded by replacing or expanding the cited ranges without rewriting the claim. Use contradicted-by-evidence when the source contradicts the claim, unsupported-inference when the chunk does not establish the asserted identity, motive, causality, chronology, relationship, or other detail, and lost-attribution when the claim turns testimony, belief, rumor, a written statement, or uncertainty into objective truth. Reject the claim when its content itself adds unsupported motive, causality, chronology, identity, relationships, current state, attribution, or other details; turns a character claim into objective truth; or removes material uncertainty. In particular, if the claim content names a person or object where the cited evidence only contains an unresolved pronoun or abbreviation, classify it as insufficient-evidence only if other lines in this supplied chunk establish that identity; otherwise classify it as unsupported-inference. Separately return one decision for every supplied referenceId. Reference validation checks entityhood and type as well as topical relevance: accept a reference only when the cited evidence establishes that the claim concerns a distinct, persistent campaign entity of the specified type. A Location must be a distinct, persistent place that could reasonably be referred to again by identity. Reject Location references that are only ordinary scenery, architectural components, surfaces, directions, or incidental spatial descriptions, such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor, unless the evidence independently establishes that feature as a distinct persistent place. A room, chamber, tunnel, district, building, region, or descriptive place can be a valid Location when the evidence treats it as an independently identifiable place. Scene or section headings are editorial context and cannot by themselves establish a canonical Location name or identity. If a heading supplies a label that the actual transcript never establishes as the place's identity, reject that reference. An unsupported extra entity reference must not cause an otherwise supported claim to be rejected unless that same unsupported identity or detail is asserted in the claim content. Do not rewrite claims or entity references. For an accepted claim, keep certainty unchanged or downgrade explicit to inferred; never upgrade inferred to explicit. The surrounding numbered chunk may be used to decide whether missing context exists and therefore whether insufficient-evidence is the right rejection reason, but substantive support for an accepted claim must come from the cited evidence."
	const worldbuildingValidationGuidance =
		'A Worldbuilding reference is valid only for a persistent setting concept with its own identity that is not primarily a person, place, item, or event, such as a religion, myth, ritual, magical phenomenon or system, social custom, law, prophecy, calendar, or institution. Reject Worldbuilding references used merely as a catch-all for isolated facts without a coherent persistent subject.'
	const evidenceRepairSystem =
		'Repair only the evidence line ranges for candidate claims that were rejected solely because their current citations were insufficient. Do not rewrite claim content, kind, certainty, or entity references. For each candidateId, inspect the supplied numbered transcript chunk and return the smallest set of replacement line ranges that collectively supports the exact existing normalized claim, including every identity, attribution, relationship, chronology statement, and coreference it expresses. You may expand the original range or cite multiple separated ranges. Never repair an unsupported claim by weakening, reinterpreting, or changing it. If the exact claim cannot be fully grounded anywhere in the supplied chunk, return an empty evidence array. Never cite outside the supplied chunk.'
	const eventAuditSystem =
		'Audit the complete set of validated development events against the full numbered transcript. Return events only when a durable in-world development is missing or when a supplied event materially overstates the transcript and needs a faithful replacement. Every returned event must be a development with a concise factual eventTitle, preserve attribution and uncertainty, and cite the smallest supporting transcript line ranges. Never strengthen outcomes: disappeared is not escaped, fell is not died, attempted is not succeeded, and an unknown fate remains unknown. Put the ID of every materially unsupported or overstated supplied event in discardedEventIds and explain why; when an observed underlying event remains useful, also return a corrected replacement event. Identify duplicateGroups only when IDs describe the same in-world occurrence, not merely related actions. Choose as canonical the event that best preserves attribution, uncertainty, and scope. Captures, rescues, deaths, discoveries, openings, item transfers, ritual changes, and meaningful disappearances are durable developments that should not be omitted. Do not return already covered events merely to rephrase them, and use only supplied IDs in discard and duplicate decisions.'
	const chronologySystem =
		'Infer loose temporal constraints that anchor the supplied new session events into the existing campaign chronology. Return relation "before" only when the full session transcript establishes that sourceEventId happened before targetEventId in the campaign world. Return relation "during" when sourceEventId happened temporally within targetEventId; the target may be a broad event such as a war, reign, journey, or festival, and the system will promote it to a period. An event may have a during relationship and no before relationships at all. Events during the same period are not ordered relative to one another unless the transcript independently establishes a before relationship. Containment may be nested. Every returned relation must involve at least one new session event; existing events are supplied as anchors, not as an invitation to reorganize unrelated campaign history. Connect present-day events to existing chronology only when the transcript and campaign context support that continuation. Historical revelations may instead relate new historical events to relevant existing historical events or periods, independently of the present-day session chain. The result is not required to be a single linear sequence: events may be unrelated, disconnected, concurrent, contained by a period, or have an unknown order. Absence of a relation means the temporal relationship is not established. Events may share a predecessor, successor, or containing period without being ordered relative to one another. Present-day actions and scene transitions establish narrative order only when the transcript clearly indicates that one action or scene follows another; transcript position by itself is not enough. Transcript position also does not order historical accounts, flashbacks, legends, prophecies, plans, hypothetical events, or out-of-character discussion. Do not infer order from plausible causality or from a need to choose one earliest or latest event. Use explicit when temporal language or the described action directly establishes the relationship; use inferred for a relationship clearly supported by context without explicit temporal language. Return the complete transitive reduction of the supported chronology, not a sample of representative relationships. Completeness means including the direct boundary relationships needed to place every confidently ordered event in its connected sequence or branch. Sparse means omitting only unsupported order and relationships already implied transitively; it does not mean leaving supported adjacent events disconnected. Return exactly one coverage decision for every candidate event: connected when it participates in a supported relation, or intentionally-unplaced with a concrete reason when its placement is genuinely unknown. Use only supplied event IDs, and never create precedence cycles, containment cycles, or a before relationship between an event and a period that contains it.'

	const numberedChunkContent = (chunk: TranscriptChunk) =>
		chunk.content
			.split(/\r?\n/)
			.slice(0, chunk.endLine - chunk.startLine + 1)
			.map((line, index) => `${chunk.startLine + index} | ${line}`)
			.join('\n')

	const transcriptChunkPrompt = (chunk: TranscriptChunk) =>
		`## Transcript chunk ${chunk.chunkId}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${numberedChunkContent(chunk)}`

	const numberedTranscript = (transcript: string) =>
		transcript
			.split(/\r?\n/)
			.map((line, index) => `${index + 1} | ${line}`)
			.join('\n')

	const completeTranscriptChunk = (transcript: string): TranscriptChunk => ({
		chunkId: 'event-audit',
		content: transcript,
		startStringIndex: 0,
		endStringIndex: transcript.length,
		startLine: 1,
		endLine: transcript.split(/\r?\n/).length
	})

	const evidenceRangesLabel = (claim: ExtractedSessionClaim) =>
		claim.evidence.map(({ startLine, endLine }) => `${startLine}-${endLine}`).join(', ') || 'none'

	const entityReferencesLabel = (claim: ExtractedSessionClaim) =>
		claim.entityReferences.map(({ label }) => label).join(', ') || 'none'

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

	const validationPrompt = (chunk: TranscriptChunk, claims: EvidenceBackedClaim[]) =>
		`${transcriptChunkPrompt(chunk)}\n\n## Candidate claims\n${JSON.stringify(
			claims.map(({ candidateId, claim, evidence }) => ({
				candidateId,
				kind: claim.kind,
				certainty: claim.certainty,
				content: claim.content,
				entityReferences: claim.entityReferences.map((reference, referenceIndex) => ({
					referenceId: entityReferenceId(candidateId, referenceIndex),
					...reference
				})),
				evidence: evidence.map(({ startLine, endLine, excerpt }) => ({
					startLine,
					endLine,
					excerpt
				}))
			})),
			null,
			2
		)}`

	const evidenceRepairPrompt = (chunk: TranscriptChunk, claims: EvidenceBackedClaim[]) =>
		`${transcriptChunkPrompt(chunk)}\n\n## Claims needing evidence repair\n${JSON.stringify(
			claims.map(({ candidateId, claim, evidence }) => ({
				candidateId,
				content: claim.content,
				entityReferences: claim.entityReferences,
				currentEvidence: evidence.map(({ startLine, endLine, excerpt }) => ({
					startLine,
					endLine,
					excerpt
				}))
			})),
			null,
			2
		)}`

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

	const eventAuditPrompt = (transcript: string, claims: ValidatedClaim[]) =>
		`## Full numbered transcript\n${numberedTranscript(transcript)}\n\n## Validated development events\n${JSON.stringify(
			claims
				.filter(({ kind }) => kind === 'development')
				.map((claim) => ({
					eventId: claim.claimId,
					title: claim.eventTitle,
					certainty: claim.certainty,
					content: claim.content,
					entityReferences: claim.entityReferences,
					evidence: claim.evidence.map(({ startLine, endLine, excerpt }) => ({
						startLine,
						endLine,
						excerpt
					}))
				})),
			null,
			2
		)}`

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

	const chronologyPrompt = (
		transcript: string,
		eventProposals: SessionProposal[],
		existingEvents: VaultDocument[]
	) => {
		const eventsWithSuccessors = new Set(existingEvents.flatMap(({ after }) => after))
		return `## Full numbered transcript\n${numberedTranscript(transcript)}\n\n## Existing campaign events\n${JSON.stringify(
			existingEvents.map((document) => ({
				eventId: document.id,
				title: document.title,
				context: candidateContext(document),
				afterEventIds: document.after,
				duringEventIds: document.during,
				eventForm: document.eventForm ?? 'occurrence',
				isChronologyFrontier: !eventsWithSuccessors.has(document.id)
			})),
			null,
			2
		)}\n\n## Candidate events\n${JSON.stringify(
			eventProposals.map((proposal) => ({
				eventId: proposal.proposalId,
				title: proposal.title,
				eventForm: 'occurrence',
				content: proposal.content,
				evidence: proposal.evidence.map(({ startLine, endLine, excerpt }) => ({
					startLine,
					endLine,
					excerpt
				}))
			})),
			null,
			2
		)}`
	}

	const existingTimelineEdges = (documents: VaultDocument[]): TimelineEdge[] => {
		const eventIds = new Set(documents.filter(({ type }) => type === 'event').map(({ id }) => id))
		return documents.flatMap((document) =>
			document.type === 'event'
				? document.after
						.filter((beforeDocumentId) => eventIds.has(beforeDocumentId))
						.map((beforeDocumentId) => ({
							beforeDocumentId,
							afterDocumentId: document.id
						}))
				: []
		)
	}

	const existingTimelineContainments = (documents: VaultDocument[]): TimelineContainment[] => {
		const eventIds = new Set(documents.filter(({ type }) => type === 'event').map(({ id }) => id))
		return documents.flatMap((document) =>
			document.type === 'event'
				? document.during
						.filter((periodDocumentId) => eventIds.has(periodDocumentId))
						.map((periodDocumentId) => ({
							eventDocumentId: document.id,
							periodDocumentId
						}))
				: []
		)
	}

	const validatedChronology = (
		inference: InferredSessionChronology,
		eventProposals: SessionProposal[],
		existingEvents: VaultDocument[]
	) => {
		const { relations } = inference
		const proposalEvents = new Map(
			eventProposals.map((proposal) => [proposal.proposalId, proposal])
		)
		const existingEventsById = new Map(existingEvents.map((document) => [document.id, document]))
		const eventIds = new Set([...proposalEvents.keys(), ...existingEventsById.keys()])
		const baseEdges = existingTimelineEdges(existingEvents)
		const baseContainments = existingTimelineContainments(existingEvents)
		const accepted: SessionChronologyProposal[] = []
		const acceptedKeys = new Set<string>()
		const warnings: string[] = []

		for (const relation of relations) {
			const key = `${relation.relation}\0${relation.sourceEventId}\0${relation.targetEventId}`
			if (
				!eventIds.has(relation.sourceEventId) ||
				!eventIds.has(relation.targetEventId) ||
				relation.sourceEventId === relation.targetEventId ||
				(!proposalEvents.has(relation.sourceEventId) &&
					!proposalEvents.has(relation.targetEventId)) ||
				acceptedKeys.has(key)
			) {
				warnings.push(
					`Chronology relation discarded [invalid-reference] ${JSON.stringify(relation)}`
				)
				continue
			}

			const endpoint = (eventId: string) => {
				const proposal = proposalEvents.get(eventId)
				if (proposal) return { eventId, title: proposal.title, source: 'proposal' as const }
				const document = existingEventsById.get(eventId)!
				return { eventId, title: document.title, source: 'existing' as const }
			}
			const candidate: SessionChronologyProposal = {
				relation: relation.relation,
				certainty: relation.certainty,
				reason: relation.reason,
				chronologyId: randomUUID(),
				selected: relation.certainty === 'explicit',
				source: endpoint(relation.sourceEventId),
				target: endpoint(relation.targetEventId)
			}
			const edges: TimelineEdge[] = [
				...baseEdges,
				...accepted
					.filter(({ relation }) => relation === 'before')
					.map(({ source, target }) => ({
						beforeDocumentId: source.eventId,
						afterDocumentId: target.eventId
					})),
				...(candidate.relation === 'before'
					? [
							{
								beforeDocumentId: candidate.source.eventId,
								afterDocumentId: candidate.target.eventId
							}
						]
					: [])
			]
			const containments: TimelineContainment[] = [
				...baseContainments,
				...accepted
					.filter(({ relation }) => relation === 'during')
					.map(({ source, target }) => ({
						eventDocumentId: source.eventId,
						periodDocumentId: target.eventId
					})),
				...(candidate.relation === 'during'
					? [
							{
								eventDocumentId: candidate.source.eventId,
								periodDocumentId: candidate.target.eventId
							}
						]
					: [])
			]
			const problem = temporalGraphProblem(edges, containments)
			if (problem) {
				warnings.push(`Chronology relation discarded [${problem}] ${JSON.stringify(relation)}`)
				continue
			}

			accepted.push(candidate)
			acceptedKeys.add(key)
		}

		const direct = accepted.filter((relation) => {
			const otherEdges = [
				...baseEdges,
				...accepted
					.filter(
						({ chronologyId, relation: kind }) =>
							chronologyId !== relation.chronologyId && kind === 'before'
					)
					.map(({ source, target }) => ({
						beforeDocumentId: source.eventId,
						afterDocumentId: target.eventId
					}))
			]
			const otherContainments = [
				...baseContainments,
				...accepted
					.filter(
						({ chronologyId, relation: kind }) =>
							chronologyId !== relation.chronologyId && kind === 'during'
					)
					.map(({ source, target }) => ({
						eventDocumentId: source.eventId,
						periodDocumentId: target.eventId
					}))
			]
			if (relation.relation === 'before') {
				return (
					temporalRelation(
						relation.source.eventId,
						relation.target.eventId,
						otherEdges,
						otherContainments
					) !== 'before'
				)
			}
			return (
				timelineRelation(
					relation.source.eventId,
					relation.target.eventId
				)(
					otherContainments.map(({ eventDocumentId, periodDocumentId }) => ({
						beforeDocumentId: eventDocumentId,
						afterDocumentId: periodDocumentId
					}))
				) !== 'before'
			)
		})

		const coverageByEventId = new Map<string, InferredSessionChronology['coverage'][number]>()
		for (const decision of inference.coverage) {
			if (!proposalEvents.has(decision.eventId) || coverageByEventId.has(decision.eventId)) {
				warnings.push(
					`Chronology coverage discarded [invalid-reference] ${JSON.stringify(decision)}`
				)
				continue
			}
			coverageByEventId.set(decision.eventId, decision)
		}
		const connectedEventIds = new Set(
			direct.flatMap(({ source, target }) => [source.eventId, target.eventId])
		)
		const coverage: SessionChronologyCoverageProposal[] = eventProposals.map((proposal) => {
			const decision = coverageByEventId.get(proposal.proposalId)
			const event = {
				eventId: proposal.proposalId,
				title: proposal.title,
				source: 'proposal' as const
			}
			const connected = connectedEventIds.has(proposal.proposalId)
			if (!decision) {
				warnings.push(
					`Chronology coverage missing for event ${JSON.stringify(proposal.proposalId)}`
				)
				return {
					event,
					status: 'missing',
					reason: 'The chronology model did not account for this event.'
				}
			}
			if (decision.status === 'connected' && !connected) {
				warnings.push(
					`Chronology coverage inconsistent [connected-without-relation] ${JSON.stringify(decision)}`
				)
				return {
					event,
					status: 'missing',
					reason: 'The event was marked connected, but no valid relationship placed it.'
				}
			}
			if (decision.status === 'intentionally-unplaced' && connected) {
				warnings.push(
					`Chronology coverage inconsistent [unplaced-with-relation] ${JSON.stringify(decision)}`
				)
				return { event, status: 'connected', reason: 'A valid chronology relationship places it.' }
			}
			return { event, status: decision.status, reason: decision.reason }
		})

		return { chronology: direct, coverage, warnings }
	}

	const inferChronology = (
		transcript: string,
		eventProposals: SessionProposal[],
		documents: VaultDocument[]
	) => {
		const existingEvents = documents.filter(({ type }) => type === 'event')
		if (!eventProposals.length || eventProposals.length + existingEvents.length < 2) {
			return succeed({
				chronology: [],
				coverage: eventProposals.map((proposal) => ({
					event: {
						eventId: proposal.proposalId,
						title: proposal.title,
						source: 'proposal' as const
					},
					status: 'intentionally-unplaced' as const,
					reason: 'No other event is available to establish a relative placement.'
				})),
				warnings: []
			})
		}
		return pipe(
			ai.inferSessionChronology({
				model: ai.analysisModel,
				system: chronologySystem,
				prompt: chronologyPrompt(transcript, eventProposals, existingEvents)
			}),
			map((inference) => validatedChronology(inference, eventProposals, existingEvents))
		)
	}

	const buildDraft = (
		input: { campaignId: string; title: string },
		claims: ValidatedClaim[],
		claimProposals: SessionProposal[],
		chronology: SessionChronologyProposal[],
		chronologyCoverage: SessionChronologyCoverageProposal[],
		warnings: string[]
	): SessionIngestionDraft => ({
		schemaVersion: 3,
		ingestionId: randomUUID(),
		campaignId: input.campaignId,
		title: input.title,
		createdAt: new Date().toISOString(),
		warnings,
		proposals: [sessionProposalFor(input.title, claims, claimProposals), ...claimProposals],
		chronology,
		chronologyCoverage
	})

	const analyze = (input: { campaignId: string; title: string; transcript: string }) =>
		gen(function* () {
			const documents = yield* vault.getDocuments(input.campaignId)
			const results: { claims: ValidatedClaim[]; warnings: string[] }[] = []
			for (const chunk of chunkTranscript(input.transcript)) {
				results.push(yield* analyzeChunk(input.transcript, chunk))
			}
			const extractedClaims = mergeClaims(results.flatMap(({ claims }) => claims))
			const audit = yield* auditEvents(input.transcript, extractedClaims)
			const resolvedClaims = yield* resolveClaims(audit.claims, documents)
			const claimProposals = mergeProposals(resolvedClaims.flatMap(proposalsForClaim))
			const chronology = yield* inferChronology(
				input.transcript,
				claimProposals.filter(({ operation }) => operation === 'create-event'),
				documents
			)
			const draft = buildDraft(
				input,
				audit.claims,
				claimProposals,
				chronology.chronology,
				chronology.coverage,
				[...results.flatMap(({ warnings }) => warnings), ...audit.warnings, ...chronology.warnings]
			)
			yield* storage.write(draft, input.transcript)
			return draft
		})

	const loadCommitContext = (input: CommitInput) =>
		all([
			storage.read(input.campaignId, input.ingestionId),
			storage.readTranscript(input.campaignId, input.ingestionId),
			vault.getDocuments(input.campaignId)
		])

	const validateSelection = (
		input: CommitInput,
		draft: SessionIngestionDraft
	): Effect<
		{
			selectedIds: Set<string>
			selected: SessionProposal[]
			selectedChronology: SessionChronologyProposal[]
			sessionProposal: SessionProposal
		},
		Failure
	> => {
		const selectedIds = new Set(input.selectedProposalIds)
		const requestedChronologyIds =
			input.selectedChronologyIds ??
			draft.chronology.filter(({ selected }) => selected).map(({ chronologyId }) => chronologyId)
		const selectedChronologyIds = new Set(requestedChronologyIds)
		const selectedChronology = draft.chronology.filter(({ chronologyId }) =>
			selectedChronologyIds.has(chronologyId)
		)
		const selected = draft.proposals.filter(({ proposalId }) => selectedIds.has(proposalId))
		if (
			input.selectedProposalIds.length !== selectedIds.size ||
			selected.length !== selectedIds.size
		) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unknownProposal' }
			} satisfies Failure)
		}
		if (
			requestedChronologyIds.length !== selectedChronologyIds.size ||
			selectedChronology.length !== selectedChronologyIds.size
		) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unknownChronologyProposal' }
			} satisfies Failure)
		}
		const sessionProposal = draft.proposals.find(({ documentType }) => documentType === 'session')
		if (!sessionProposal || !selectedIds.has(sessionProposal.proposalId)) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'sessionProposalRequired' }
			} satisfies Failure)
		}
		if (selected.some((proposal) => proposal.operation === 'mention-only')) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unselectableProposal' }
			} satisfies Failure)
		}
		return succeed({ selectedIds, selected, selectedChronology, sessionProposal })
	}

	const resolutionMapFor = (
		input: CommitInput,
		selectedIds: Set<string>
	): Effect<Map<string, SessionProposalResolution>, Failure> => {
		const resolutions = input.resolutions ?? []
		const resolutionByProposal = new Map(
			resolutions.map((resolution) => [resolution.proposalId, resolution])
		)
		if (
			resolutionByProposal.size !== resolutions.length ||
			resolutions.some(({ proposalId }) => !selectedIds.has(proposalId))
		) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'invalidResolution' }
			} satisfies Failure)
		}
		return succeed(resolutionByProposal)
	}

	const applyProposalResolution = (
		proposal: SessionProposal,
		resolution?: SessionProposalResolution
	): Effect<SessionProposal, Failure> => {
		if (proposal.match.kind !== 'unresolved' || proposal.match.candidates.length === 0) {
			return resolution
				? failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
					} satisfies Failure)
				: succeed(proposal)
		}
		if (!resolution) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'unresolvedMatch', proposalId: proposal.proposalId }
			} satisfies Failure)
		}
		if (resolution.kind === 'create') {
			return proposal.canCreate
				? succeed(proposal)
				: failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
					} satisfies Failure)
		}
		const candidate = proposal.match.candidates.find(
			({ documentId }) => documentId === resolution.documentId
		)
		if (!candidate) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
			} satisfies Failure)
		}
		return succeed({
			...proposal,
			operation: 'update-canon',
			documentType: candidate.documentType,
			title: candidate.title,
			match: {
				kind: 'exact',
				documentId: candidate.documentId,
				title: candidate.title,
				documentType: candidate.documentType
			},
			base: { documentId: candidate.documentId, revisionId: candidate.revisionId },
			patch: { kind: 'append', content: proposal.content }
		})
	}

	const resolveSelectedProposals = (
		input: CommitInput,
		selectedIds: Set<string>,
		selected: SessionProposal[]
	): Effect<SessionProposal[], Failure> =>
		pipe(
			resolutionMapFor(input, selectedIds),
			flatMap((resolutions) =>
				all(
					selected.map((proposal) =>
						applyProposalResolution(proposal, resolutions.get(proposal.proposalId))
					)
				)
			)
		)

	const documentIdsFor = (proposals: SessionProposal[]) =>
		new Map(
			proposals.map((proposal) => [
				proposal.proposalId,
				proposal.operation === 'update-canon' && proposal.base
					? proposal.base.documentId
					: randomUUID()
			])
		)

	const planMutations = (
		resolvedSelected: SessionProposal[],
		selectedChronology: SessionChronologyProposal[],
		sessionProposal: SessionProposal,
		documents: VaultDocument[]
	): Effect<MutationPlan, Failure> => {
		const documentIdByProposal = documentIdsFor(resolvedSelected)
		const existingById = new Map(documents.map((document) => [document.id, document]))
		const proposalById = new Map(
			resolvedSelected.map((proposal) => [proposal.proposalId, proposal])
		)
		const documentIdForEndpoint = (endpoint: SessionChronologyProposal['source']) => {
			if (endpoint.source === 'proposal') {
				const proposal = proposalById.get(endpoint.eventId)
				return proposal?.documentType === 'event'
					? documentIdByProposal.get(endpoint.eventId)
					: undefined
			}
			const document = existingById.get(endpoint.eventId)
			return document?.type === 'event' ? document.id : undefined
		}
		const chronologyEdges: TimelineEdge[] = []
		const chronologyContainments: TimelineContainment[] = []
		for (const relation of selectedChronology) {
			const sourceDocumentId = documentIdForEndpoint(relation.source)
			const targetDocumentId = documentIdForEndpoint(relation.target)
			if (!sourceDocumentId || !targetDocumentId) continue
			if (relation.relation === 'before') {
				chronologyEdges.push({
					beforeDocumentId: sourceDocumentId,
					afterDocumentId: targetDocumentId
				})
			} else {
				chronologyContainments.push({
					eventDocumentId: sourceDocumentId,
					periodDocumentId: targetDocumentId
				})
			}
		}
		const chronologyProblem = temporalGraphProblem(
			[...existingTimelineEdges(documents), ...chronologyEdges],
			[...existingTimelineContainments(documents), ...chronologyContainments]
		)
		if (chronologyProblem) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'invalidChronology', problem: chronologyProblem }
			} satisfies Failure)
		}
		const predecessorsByDocumentId = new Map<string, string[]>()
		for (const { beforeDocumentId, afterDocumentId } of chronologyEdges) {
			const predecessors = predecessorsByDocumentId.get(afterDocumentId) ?? []
			predecessors.push(beforeDocumentId)
			predecessorsByDocumentId.set(afterDocumentId, predecessors)
		}
		const periodsByDocumentId = new Map<string, string[]>()
		const periodDocumentIds = new Set<string>()
		for (const { eventDocumentId, periodDocumentId } of chronologyContainments) {
			const periods = periodsByDocumentId.get(eventDocumentId) ?? []
			periods.push(periodDocumentId)
			periodsByDocumentId.set(eventDocumentId, periods)
			periodDocumentIds.add(periodDocumentId)
		}
		const updatedDocumentIds = resolvedSelected
			.filter(({ operation }) => operation === 'update-canon')
			.map((proposal) => documentIdByProposal.get(proposal.proposalId)!)
		if (new Set(updatedDocumentIds).size !== updatedDocumentIds.length) {
			return failEffect({
				domain: 'ingestion',
				operation: 'commit',
				cause: { reason: 'duplicateDocumentMutation' }
			} satisfies Failure)
		}

		const planned: PlannedMutation[] = []
		const createPaths = new Set(documents.map(({ path }) => path))
		const nextCreatePath = (proposal: SessionProposal) => {
			const directory = categoryDirectory[proposal.documentType]
			const slug = toSlug(proposal.title)
			let suffix = 1
			let path = `${directory}/${slug}.md`
			while (createPaths.has(path)) {
				suffix += 1
				path = `${directory}/${slug}-${suffix}.md`
			}
			createPaths.add(path)
			return path
		}
		for (const proposal of resolvedSelected) {
			if (proposal.operation === 'record-only') continue
			const documentId = documentIdByProposal.get(proposal.proposalId)!
			if (proposal.operation === 'update-canon') {
				const existing = existingById.get(documentId)
				if (!existing || !proposal.base || !proposal.patch) {
					return failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'missingUpdateBase', proposalId: proposal.proposalId }
					} satisfies Failure)
				}
				const addedPredecessors = predecessorsByDocumentId.get(documentId) ?? []
				const addedPeriods = periodsByDocumentId.get(documentId) ?? []
				planned.push({
					proposal,
					documentId,
					after: [...new Set([...existing.after, ...addedPredecessors])],
					during: [...new Set([...existing.during, ...addedPeriods])],
					eventForm:
						existing.type === 'event'
							? periodDocumentIds.has(documentId)
								? 'period'
								: (existing.eventForm ?? 'occurrence')
							: undefined
				})
				continue
			}

			const after = [...new Set(predecessorsByDocumentId.get(documentId) ?? [])]
			const during = [...new Set(periodsByDocumentId.get(documentId) ?? [])]
			const path = nextCreatePath(proposal)
			planned.push({
				proposal,
				documentId,
				path,
				after,
				during,
				eventForm:
					proposal.documentType === 'event'
						? periodDocumentIds.has(documentId)
							? 'period'
							: 'occurrence'
						: undefined
			})
		}
		const updatedDocumentIdSet = new Set(updatedDocumentIds)
		const createdDocumentIds = new Set(
			planned
				.filter(({ proposal }) => proposal.operation !== 'update-canon')
				.map(({ documentId }) => documentId)
		)
		const chronologyUpdates: MutationPlan['chronologyUpdates'] = []
		const chronologyUpdateIds = new Set([
			...predecessorsByDocumentId.keys(),
			...periodsByDocumentId.keys(),
			...periodDocumentIds
		])
		for (const documentId of chronologyUpdateIds) {
			if (createdDocumentIds.has(documentId) || updatedDocumentIdSet.has(documentId)) continue
			const existing = existingById.get(documentId)
			if (!existing || existing.type !== 'event' || !existing.currentRevisionId) {
				return failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'missingChronologyBase', documentId }
				} satisfies Failure)
			}
			const addedPredecessors = predecessorsByDocumentId.get(documentId) ?? []
			const addedPeriods = periodsByDocumentId.get(documentId) ?? []
			chronologyUpdates.push({
				documentId,
				after: [...new Set([...existing.after, ...addedPredecessors])],
				during: [...new Set([...existing.during, ...addedPeriods])],
				eventForm: periodDocumentIds.has(documentId)
					? 'period'
					: (existing.eventForm ?? 'occurrence')
			})
		}

		return succeed({
			planned,
			chronologyUpdates,
			documentIdByProposal,
			existingById,
			sessionDocumentId: documentIdByProposal.get(sessionProposal.proposalId)!
		})
	}

	const revisionFor = (
		proposal: SessionProposal,
		draft: SessionIngestionDraft,
		ingestionId: string,
		sessionDocumentId: string
	) => ({
		source: 'ingestion' as const,
		relatedSessionId: sessionDocumentId,
		ingestionId,
		changeSummary:
			proposal.documentType === 'session'
				? `Created from session ingestion: ${draft.title}`
				: `Applied from session: ${draft.title}`
	})

	const applyMutationPlan = (
		input: CommitInput,
		draft: SessionIngestionDraft,
		transcript: string,
		resolvedSelected: SessionProposal[],
		plan: MutationPlan
	): Effect<SessionIngestionResult, Failure> =>
		gen(function* () {
			const committed: SessionIngestionResult['documents'] = []
			const approvedSessionContent = buildSessionRecap(
				draft.title,
				resolvedSelected.filter(({ documentType }) => documentType !== 'session')
			)
			const creates = plan.planned.filter(({ proposal }) => proposal.operation !== 'update-canon')
			const updates = plan.planned.filter(({ proposal }) => proposal.operation === 'update-canon')
			const eventCreates = creates.filter(({ proposal }) => proposal.documentType === 'event')
			const eventCreateIds = new Set(eventCreates.map(({ documentId }) => documentId))
			const eventCreateEdges = eventCreates.flatMap(({ documentId, after = [] }) =>
				after
					.filter((beforeDocumentId) => eventCreateIds.has(beforeDocumentId))
					.map((beforeDocumentId) => ({ beforeDocumentId, afterDocumentId: documentId }))
			)
			const eventContainmentDependencies = eventCreates.flatMap(({ documentId, during = [] }) =>
				during
					.filter((periodDocumentId) => eventCreateIds.has(periodDocumentId))
					.map((periodDocumentId) => ({
						beforeDocumentId: periodDocumentId,
						afterDocumentId: documentId
					}))
			)
			const layers =
				topologicalLayers(
					[...eventCreateIds],
					[...eventCreateEdges, ...eventContainmentDependencies]
				) ?? []
			const eventRank = new Map(
				layers.flatMap((layer, index) => layer.map((documentId) => [documentId, index] as const))
			)
			const orderedCreates = [
				...creates.filter(({ proposal }) => proposal.documentType !== 'event'),
				...eventCreates.sort(
					(left, right) =>
						(eventRank.get(left.documentId) ?? 0) - (eventRank.get(right.documentId) ?? 0)
				)
			]
			for (const { proposal, documentId, path, after, during, eventForm } of orderedCreates) {
				const revision = revisionFor(proposal, draft, input.ingestionId, plan.sessionDocumentId)
				yield* vault.createDocument(input.campaignId, {
					documentId,
					path: path!,
					type: proposal.documentType,
					content:
						proposal.documentType === 'session'
							? approvedSessionContent
							: canonicalDocumentContent(proposal.title, proposal.content),
					after,
					during,
					eventForm,
					ingestionId: proposal.documentType === 'session' ? input.ingestionId : undefined,
					transcript: proposal.documentType === 'session' ? transcript : undefined,
					revision
				})
				committed.push({
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType
				})
			}
			for (const { proposal, documentId, after, during, eventForm } of updates) {
				const existing = plan.existingById.get(documentId)!
				yield* vault.updateDocument(input.campaignId, documentId, {
					type: existing.type,
					aliases: existing.aliases,
					after,
					during,
					eventForm,
					content: `${existing.content.trimEnd()}\n\n${proposal.patch!.content.trim()}\n`,
					expectedRevisionId: proposal.base!.revisionId,
					revision: revisionFor(proposal, draft, input.ingestionId, plan.sessionDocumentId)
				})
				committed.push({
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType
				})
			}
			for (const { documentId, after, during, eventForm } of plan.chronologyUpdates) {
				const existing = plan.existingById.get(documentId)!
				yield* vault.updateDocument(input.campaignId, documentId, {
					type: existing.type,
					aliases: existing.aliases,
					after,
					during,
					eventForm,
					content: existing.content,
					expectedRevisionId: existing.currentRevisionId!,
					revision: {
						source: 'ingestion',
						relatedSessionId: plan.sessionDocumentId,
						ingestionId: input.ingestionId,
						changeSummary: `Updated chronology from session: ${draft.title}`
					}
				})
			}
			return { documents: committed, sessionDocumentId: plan.sessionDocumentId }
		})

	const commit = (input: CommitInput): Effect<SessionIngestionResult, Failure> =>
		gen(function* () {
			const [draft, transcript, documents] = yield* loadCommitContext(input)
			const selection = yield* validateSelection(input, draft)
			const resolvedSelected = yield* resolveSelectedProposals(
				input,
				selection.selectedIds,
				selection.selected
			)
			const plan = yield* planMutations(
				resolvedSelected,
				selection.selectedChronology,
				selection.sessionProposal,
				documents
			)
			return yield* applyMutationPlan(input, draft, transcript, resolvedSelected, plan)
		})

	return { analyze, commit, getDraft: storage.read }
}
