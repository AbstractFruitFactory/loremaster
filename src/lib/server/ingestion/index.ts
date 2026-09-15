import { randomUUID } from 'node:crypto'
import { all, fail as failEffect, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { buildSessionRecap, canonicalDocumentContent } from '../../ingestion'
import type { AiProvider } from '../ai/provider'
import type { Failure } from '../failure'
import type { VaultDocument } from '../vault/types'
import { chunkTranscript } from './chunking'
import { materializeEvidenceRanges } from './evidence'
import { contextualCandidates, matchDocument } from './matching'
import type { IngestionStorage } from './storage'
import type {
	EntityReference,
	Evidence,
	ExtractedSessionClaim,
	IngestionDocumentType,
	ProposalCandidate,
	ProposalMatch,
	SessionClaimEvidenceRepair,
	SessionClaimValidation,
	SessionIngestionDraft,
	SessionEntityResolution,
	SessionIngestionResult,
	SessionProposal,
	SessionProposalResolution
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
	resolutions?: SessionProposalResolution[]
}

type PlannedMutation = {
	proposal: SessionProposal
	documentId: string
	path?: string
	after?: string[]
}

type MutationPlan = {
	planned: PlannedMutation[]
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
		after: [],
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
	after: [],
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
	after: [],
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
	after: [],
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
				after: [],
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
	after: [],
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
			after: uniqueReferences([...existing.after, ...proposal.after]),
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
		'Extract atomic campaign claims from the numbered transcript. Claims describe evidence, not how campaign canon should be stored: do not invent document titles or choose destination documents. Every claim must cite one or more supporting line ranges from the numbered transcript. Cite the smallest set of ranges that collectively supports the full normalized claim. The cited evidence itself must establish every identity, attribution, relationship, chronology statement, and coreference expressed in the claim: if you normalize pronouns or contextual references such as "she", "her", "it", or "E. Vey" into a named entity, expand the range or cite additional ranges that establish that identity. Do not rely on uncited surrounding lines to justify a normalized identity. Use multiple ranges when a conversation or separated statements are needed. Entity references are semantic identifiers, not quotations: include each distinct campaign entity the claim is materially about, using the clearest concise name or contextual identifier supported by the cited evidence. Only emit entity references for durable campaign entities with independent identity; do not turn every noun, physical feature, or piece of scenery into an entity. Use worldbuilding for a persistent setting concept with its own identity that is not primarily a person, place, item, or event, such as a religion, myth, ritual, magical phenomenon or system, social custom, law, prophecy, calendar, or institution. Do not use worldbuilding as a catch-all for isolated facts without a coherent persistent subject. A location reference must denote a distinct, persistent place that the campaign could reasonably refer to again by identity. Ordinary scenery or architectural/spatial fragments such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor are not Locations merely because something happens there. A room, chamber, tunnel, district, building, region, or descriptively named place may be a Location when the evidence establishes it as a distinct persistent place. Scene or section headings are editorial structure, not canonical entity names or evidence that a place has that identity; never use a heading alone to create or name an entity. If a claim concerns an environmental detail inside a place but no distinct sub-location is established, omit that location reference rather than inventing one. Entity-reference labels that may become document titles must be display-ready canonical names. Preserve capitalization established by the campaign, including proper names and acronyms. When the evidence establishes a descriptive entity but not a canonical capitalization, format the label as a readable title rather than copying sentence casing; for example, emit \"Service Tunnels Below Cathedral Square\" rather than \"service tunnels below Cathedral Square\". Do not mechanically rewrite an explicitly established unusual name. Entity-reference labels do not need to occur verbatim in the cited lines, but do not resolve ambiguous identities by plausibility; for example, keep "E. Vey" rather than changing it to "Elias Vey" unless the cited evidence establishes they are the same person. Avoid incidental or speculative entity references. Mark interpretation as inferred and mere names as mentions. For every development claim, set eventTitle to a concise factual label suitable for a timeline or list: usually 3-8 words and under 60 characters. The title must summarize only the claim content and must not introduce new identity, motive, causality, chronology, or interpretation. Prefer plain labels such as "Empty Bell cracks", "Talven\'s body discovered", or "Saltwater draft in Weaver\'s Cut" rather than full sentences or dramatic prose. For stable-fact and mention claims, set eventTitle to null. Do not turn a property or topic into an entity: use "Mara", not "Mara\'s age".'
	const validationSystem =
		"Independently verify candidate campaign claims against their cited transcript evidence. Judge claim content separately from semantic entity-reference metadata. For each candidateId, accepted refers only to whether the cited evidence collectively supports the exact claim content. Always return a reason. Use supported only when accepted is true. When rejected, use insufficient-evidence only when the exact existing claim appears supportable from other lines in the supplied transcript chunk and could be grounded by replacing or expanding the cited ranges without rewriting the claim. Use contradicted-by-evidence when the source contradicts the claim, unsupported-inference when the chunk does not establish the asserted identity, motive, causality, chronology, relationship, or other detail, and lost-attribution when the claim turns testimony, belief, rumor, a written statement, or uncertainty into objective truth. Reject the claim when its content itself adds unsupported motive, causality, chronology, identity, relationships, current state, attribution, or other details; turns a character claim into objective truth; or removes material uncertainty. In particular, if the claim content names a person or object where the cited evidence only contains an unresolved pronoun or abbreviation, classify it as insufficient-evidence only if other lines in this supplied chunk establish that identity; otherwise classify it as unsupported-inference. Separately return one decision for every supplied referenceId. Reference validation checks entityhood and type as well as topical relevance: accept a reference only when the cited evidence establishes that the claim concerns a distinct, persistent campaign entity of the specified type. A Location must be a distinct, persistent place that could reasonably be referred to again by identity. Reject Location references that are only ordinary scenery, architectural components, surfaces, directions, or incidental spatial descriptions, such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor, unless the evidence independently establishes that feature as a distinct persistent place. A room, chamber, tunnel, district, building, region, or descriptive place can be a valid Location when the evidence treats it as an independently identifiable place. Scene or section headings are editorial context and cannot by themselves establish a canonical Location name or identity. If a heading supplies a label that the actual transcript never establishes as the place's identity, reject that reference. An unsupported extra entity reference must not cause an otherwise supported claim to be rejected unless that same unsupported identity or detail is asserted in the claim content. Do not rewrite claims or entity references. For an accepted claim, keep certainty unchanged or downgrade explicit to inferred; never upgrade inferred to explicit. The surrounding numbered chunk may be used to decide whether missing context exists and therefore whether insufficient-evidence is the right rejection reason, but substantive support for an accepted claim must come from the cited evidence."
	const worldbuildingValidationGuidance =
		'A Worldbuilding reference is valid only for a persistent setting concept with its own identity that is not primarily a person, place, item, or event, such as a religion, myth, ritual, magical phenomenon or system, social custom, law, prophecy, calendar, or institution. Reject Worldbuilding references used merely as a catch-all for isolated facts without a coherent persistent subject.'
	const evidenceRepairSystem =
		'Repair only the evidence line ranges for candidate claims that were rejected solely because their current citations were insufficient. Do not rewrite claim content, kind, certainty, or entity references. For each candidateId, inspect the supplied numbered transcript chunk and return the smallest set of replacement line ranges that collectively supports the exact existing normalized claim, including every identity, attribution, relationship, chronology statement, and coreference it expresses. You may expand the original range or cite multiple separated ranges. Never repair an unsupported claim by weakening, reinterpreting, or changing it. If the exact claim cannot be fully grounded anywhere in the supplied chunk, return an empty evidence array. Never cite outside the supplied chunk.'

	const numberedChunkContent = (chunk: TranscriptChunk) =>
		chunk.content
			.split(/\r?\n/)
			.slice(0, chunk.endLine - chunk.startLine + 1)
			.map((line, index) => `${chunk.startLine + index} | ${line}`)
			.join('\n')

	const transcriptChunkPrompt = (chunk: TranscriptChunk) =>
		`## Transcript chunk ${chunk.chunkId}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${numberedChunkContent(chunk)}`

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

	const analyzeChunk = (transcript: string, chunk: TranscriptChunk) =>
		gen(function* () {
			const extracted = yield* ai.analyzeSessionChunk({
				model: ai.analysisModel,
				system: extractionSystem,
				prompt: transcriptChunkPrompt(chunk)
			})
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
		after: [],
		content: buildSessionRecap(
			title,
			claimProposals.filter(({ selected }) => selected)
		)
	})

	const buildDraft = (
		input: { campaignId: string; title: string },
		claims: ValidatedClaim[],
		claimProposals: SessionProposal[],
		warnings: string[]
	): SessionIngestionDraft => ({
		schemaVersion: 1,
		ingestionId: randomUUID(),
		campaignId: input.campaignId,
		title: input.title,
		createdAt: new Date().toISOString(),
		warnings,
		proposals: [sessionProposalFor(input.title, claims, claimProposals), ...claimProposals]
	})

	const analyze = (input: { campaignId: string; title: string; transcript: string }) =>
		gen(function* () {
			const documents = yield* vault.getDocuments(input.campaignId)
			const results: { claims: ValidatedClaim[]; warnings: string[] }[] = []
			for (const chunk of chunkTranscript(input.transcript)) {
				results.push(yield* analyzeChunk(input.transcript, chunk))
			}
			const claims = mergeClaims(results.flatMap(({ claims }) => claims))
			const resolvedClaims = yield* resolveClaims(claims, documents)
			const claimProposals = mergeProposals(resolvedClaims.flatMap(proposalsForClaim))
			const draft = buildDraft(
				input,
				claims,
				claimProposals,
				results.flatMap(({ warnings }) => warnings)
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
		{ selectedIds: Set<string>; selected: SessionProposal[]; sessionProposal: SessionProposal },
		Failure
	> => {
		const selectedIds = new Set(input.selectedProposalIds)
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
		return succeed({ selectedIds, selected, sessionProposal })
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

	const resolveChronology = (
		proposal: SessionProposal,
		existingById: Map<string, VaultDocument>,
		selectedByTitle: Map<string, string>
	) => {
		const resolved: string[] = []
		for (const reference of proposal.after) {
			const documentId =
				(reference.documentId && existingById.has(reference.documentId)
					? reference.documentId
					: undefined) ?? selectedByTitle.get(normalize(reference.label))
			if (!documentId) return undefined
			resolved.push(documentId)
		}
		return [...new Set(resolved)]
	}

	const planMutations = (
		resolvedSelected: SessionProposal[],
		sessionProposal: SessionProposal,
		documents: VaultDocument[]
	): Effect<MutationPlan, Failure> => {
		const documentIdByProposal = documentIdsFor(resolvedSelected)
		const selectedByTitle = new Map(
			resolvedSelected
				.filter(({ operation }) => operation !== 'record-only')
				.map((proposal) => [
					normalize(proposal.title),
					documentIdByProposal.get(proposal.proposalId)!
				])
		)
		const existingById = new Map(documents.map((document) => [document.id, document]))
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
				if (!existingById.has(documentId) || !proposal.base || !proposal.patch) {
					return failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'missingUpdateBase', proposalId: proposal.proposalId }
					} satisfies Failure)
				}
				planned.push({ proposal, documentId })
				continue
			}

			const after = resolveChronology(proposal, existingById, selectedByTitle)
			if (!after) {
				return failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'unresolvedChronology', proposalId: proposal.proposalId }
				} satisfies Failure)
			}
			const path = nextCreatePath(proposal)
			planned.push({ proposal, documentId, path, after })
		}

		return succeed({
			planned,
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
			for (const { proposal, documentId, path, after } of plan.planned) {
				const revision = revisionFor(proposal, draft, input.ingestionId, plan.sessionDocumentId)
				if (proposal.operation === 'update-canon') {
					const existing = plan.existingById.get(documentId)!
					yield* vault.updateDocument(input.campaignId, documentId, {
						type: existing.type,
						aliases: existing.aliases,
						after: existing.after,
						content: `${existing.content.trimEnd()}\n\n${proposal.patch!.content.trim()}\n`,
						expectedRevisionId: proposal.base!.revisionId,
						revision
					})
				} else {
					yield* vault.createDocument(input.campaignId, {
						documentId,
						path: path!,
						type: proposal.documentType,
						content:
							proposal.documentType === 'session'
								? approvedSessionContent
								: canonicalDocumentContent(proposal.title, proposal.content),
						after,
						ingestionId: proposal.documentType === 'session' ? input.ingestionId : undefined,
						transcript: proposal.documentType === 'session' ? transcript : undefined,
						revision
					})
				}
				committed.push({
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType
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
			const plan = yield* planMutations(resolvedSelected, selection.sessionProposal, documents)
			return yield* applyMutationPlan(input, draft, transcript, resolvedSelected, plan)
		})

	return { analyze, commit, getDraft: storage.read }
}
