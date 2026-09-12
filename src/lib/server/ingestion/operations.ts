import { randomUUID } from 'node:crypto'
import { all, fail as failEffect, flatMap, gen, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { buildSessionRecap, canonicalDocumentContent } from '../../ingestion'
import type { AiProvider } from '../ai/provider'
import type { Failure } from '../failure'
import type { VaultDocument } from '../vault/types'
import { chunkTranscript } from './chunking'
import { locateEvidence } from './evidence'
import { contextualCandidates, matchDocument } from './matching'
import type { IngestionStorage } from './storage'
import type {
	EntityMention,
	Evidence,
	ExtractedSessionClaim,
	IngestionDocumentType,
	ProposalCandidate,
	ProposalMatch,
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
	lore: 'Lore',
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
const normalizedText = (value: string) => normalize(value).replace(/\s+/g, ' ')
const wordTokens = (value: string) => normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []

const uniqueStrings = (values: string[]) => [
	...new Map(values.map((value) => [normalize(value), value])).values()
]

const uniqueEvidence = (evidence: Evidence[]) => [
	...new Map(
		evidence.map((item) => [`${item.startStringIndex}:${item.endStringIndex}`, item])
	).values()
]

const uniqueEntityMentions = (mentions: EntityMention[]) => [
	...new Map(
		mentions.map((mention) => [`${mention.type}:${normalize(mention.mention)}`, mention])
	).values()
]

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

type ValidatedClaim = ExtractedSessionClaim & {
	claimId: string
	evidence: Evidence[]
}

type EvidenceBackedClaim = {
	claimIndex: number
	claim: ExtractedSessionClaim
	evidence: Evidence
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
			mention: EntityMention
			document: VaultDocument & { currentRevisionId: string }
			method: 'deterministic' | 'model'
	  }
	| {
			kind: 'session'
			mention: EntityMention
			candidate: SessionEntityCandidate
			method: 'deterministic' | 'model'
	  }
	| {
			kind: 'unresolved'
			mention: EntityMention
			match: { kind: 'unresolved'; candidates: ProposalCandidate[] }
			canCreate: boolean
	  }

type ResolvedClaim = ValidatedClaim & {
	entities: EntityResolution[]
}

type MentionOccurrence = {
	referenceId: string
	claim: ValidatedClaim
	mention: EntityMention
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
	occurrence: MentionOccurrence
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

const normalizedClaimKey = (claim: ExtractedSessionClaim) =>
	JSON.stringify([
		claim.kind,
		normalize(claim.content),
		claim.entityMentions.map(({ mention, type }) => [type, normalize(mention)])
	])

const validationClaimKey = (claim: ExtractedSessionClaim) =>
	JSON.stringify([
		claim.excerpt,
		claim.kind,
		claim.content,
		claim.entityMentions.map(({ mention, type }) => [mention, type])
	])

const validationCertainties = (claims: ExtractedSessionClaim[]) => {
	const certainties = new Map<string, ExtractedSessionClaim['certainty']>()
	for (const claim of claims) {
		const key = validationClaimKey(claim)
		const current = certainties.get(key)
		if (!current || claim.certainty === 'inferred') certainties.set(key, claim.certainty)
	}
	return certainties
}

const mergeClaims = (claims: ValidatedClaim[]) => {
	const merged = new Map<string, ValidatedClaim>()
	for (const claim of claims) {
		const key = normalizedClaimKey(claim)
		const existing = merged.get(key)
		if (existing) {
			existing.evidence = uniqueEvidence([...existing.evidence, ...claim.evidence])
			existing.entityMentions = uniqueEntityMentions([
				...existing.entityMentions,
				...claim.entityMentions
			])
			if (claim.certainty === 'inferred') existing.certainty = 'inferred'
		} else merged.set(key, { ...claim, evidence: [...claim.evidence] })
	}
	return [...merged.values()]
}

const mentionIsInExcerpt = (mention: string, excerpt: string) =>
	normalizedText(excerpt).includes(normalizedText(mention))

const canCreateEntityFromMention = (mention: EntityMention) => {
	if (mention.type === 'event' || mention.type === 'lore') return false
	const value = mention.mention.trim()
	if (!value || value.length > 80) return false
	if (/['’]s\b/iu.test(value)) return false
	if (/^(?:his|her|their|its|my|your|our|someone|somebody|something)\b/iu.test(value)) return false
	const capitalized = value.match(/\b\p{Lu}[\p{L}\p{N}'’.-]*/gu) ?? []
	return capitalized.some((word) => !/^(?:A|An|The)$/u.test(word))
}

const tokenSubset = (left: string, right: string) => {
	const leftTokens = new Set(wordTokens(left))
	const rightTokens = new Set(wordTokens(right))
	return leftTokens.size > 0 && [...leftTokens].every((token) => rightTokens.has(token))
}

const sessionCandidateTitle = (
	occurrence: MentionOccurrence,
	provisional: MentionOccurrence[]
): string | undefined => {
	const compatible = provisional.filter(
		(candidate) =>
			candidate.mention.type === occurrence.mention.type &&
			tokenSubset(occurrence.mention.mention, candidate.mention.mention)
	)
	if (!compatible.length) return undefined
	const maxTokens = Math.max(...compatible.map(({ mention }) => wordTokens(mention.mention).length))
	const strongest = uniqueStrings(
		compatible
			.filter(({ mention }) => wordTokens(mention.mention).length === maxTokens)
			.map(({ mention }) => mention.mention)
	)
	return strongest.length === 1 ? strongest[0] : undefined
}

const candidateContext = (document: VaultDocument) =>
	[document.summary, document.content].filter(Boolean).join('\n').slice(0, 1_600)

const eventTitle = (content: string) => {
	const firstLine = content.trim().split(/\r?\n/, 1)[0] ?? 'Session event'
	const withoutPunctuation = firstLine.replace(/[.!?]+$/u, '').trim()
	return withoutPunctuation.slice(0, 90) || 'Session event'
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
				return { label: entity.mention.mention, documentId: entity.document.id }
			}
			if (entity.kind === 'session') {
				return { label: entity.candidate.title }
			}
			return { label: entity.mention.mention }
		})
	)

const unresolvedCandidatesFor = (entities: EntityResolution[]) =>
	entities.filter(
		(entity): entity is Extract<EntityResolution, { kind: 'unresolved' }> =>
			entity.kind === 'unresolved'
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
		documentType: first?.mention.type ?? 'lore',
		title: first?.mention.mention ?? recordTitle(claim.content),
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
	title: eventTitle(claim.content),
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
	references: SessionProposal['references'],
	hasUnresolved: boolean
): SessionProposal => ({
	proposalId: randomUUID(),
	claimIds: [claim.claimId],
	operation: 'update-canon',
	documentType: entity.document.type,
	title: entity.document.title,
	certainty: claim.certainty,
	selected: claim.certainty === 'explicit' && entity.method === 'deterministic' && !hasUnresolved,
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
	references: SessionProposal['references'],
	hasUnresolved: boolean
): SessionProposal => ({
	proposalId: randomUUID(),
	claimIds: [claim.claimId],
	operation: 'create-entity',
	documentType: entity.candidate.type,
	title: entity.candidate.title,
	certainty: claim.certainty,
	selected: claim.certainty === 'explicit' && entity.method === 'deterministic' && !hasUnresolved,
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
				documentType: entity.mention.type,
				title: entity.mention.mention,
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
	documentType: 'lore',
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
	const hasUnresolved = unresolvedCandidatesFor(claim.entities).length > 0
	const proposals = claim.entities.flatMap((entity) => {
		if (entity.kind === 'existing') {
			return [updateEntityProposal(claim, entity, references, hasUnresolved)]
		}
		if (entity.kind === 'session') {
			return [createSessionEntityProposal(claim, entity, references, hasUnresolved)]
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

export const sessionIngestionOperations = ({
	ai,
	storage,
	vault
}: {
	ai: Pick<AiProvider, 'analyzeSessionChunk' | 'resolveSessionEntities'> & {
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
	const createMentionOccurrences = (
		claims: ValidatedClaim[],
		documents: VaultDocument[]
	): MentionOccurrence[] =>
		claims.flatMap((claim) =>
			claim.entityMentions.map((mention) => ({
				referenceId: randomUUID(),
				claim,
				mention,
				match: matchDocument(mention.mention, documents, mention.type)
			}))
		)

	const resolveExactOccurrences = (
		occurrences: MentionOccurrence[],
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
				mention: occurrence.mention,
				document: document as VaultDocument & { currentRevisionId: string },
				method: 'deterministic'
			})
		}
		return resolutions
	}

	const unresolvedOccurrences = (
		occurrences: MentionOccurrence[],
		resolutions: Map<string, EntityResolution>
	) => occurrences.filter(({ referenceId }) => !resolutions.has(referenceId))

	const provisionalSessionOccurrences = (occurrences: MentionOccurrence[]) =>
		occurrences.filter(
			(occurrence) =>
				occurrence.match.kind === 'unresolved' &&
				occurrence.match.candidates.length === 0 &&
				canCreateEntityFromMention(occurrence.mention)
		)

	const buildSessionCandidates = (provisional: MentionOccurrence[]) => {
		const candidates = new Map<string, SessionEntityCandidate>()
		const byReference = new Map<string, SessionEntityCandidate>()
		for (const occurrence of provisional) {
			const title = sessionCandidateTitle(occurrence, provisional)
			if (!title) continue
			const key = `${occurrence.mention.type}:${normalize(title)}`
			const candidate = candidates.get(key) ?? {
				targetId: `session:${key}`,
				title,
				type: occurrence.mention.type,
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
		provisional: MentionOccurrence[],
		byReference: Map<string, SessionEntityCandidate>,
		resolutions: Map<string, EntityResolution>
	) => {
		for (const occurrence of provisional) {
			const candidate = byReference.get(occurrence.referenceId)
			if (!candidate) continue
			resolutions.set(occurrence.referenceId, {
				kind: 'session',
				mention: occurrence.mention,
				candidate,
				method: 'deterministic'
			})
		}
	}

	const existingResolutionCandidates = (
		occurrence: MentionOccurrence,
		context: string,
		documents: VaultDocument[]
	): ResolutionCandidate[] =>
		contextualCandidates(
			occurrence.mention.mention,
			context,
			documents,
			occurrence.mention.type
		).flatMap((candidate) => {
			const document = documents.find(({ id }) => id === candidate.documentId)
			return document
				? [
						{
							targetId: `document:${candidate.documentId}`,
							title: candidate.title,
							type: occurrence.mention.type,
							context: candidateContext(document),
							candidate
						}
					]
				: []
		})

	const sessionResolutionCandidates = (
		occurrence: MentionOccurrence,
		sessionCandidates: Map<string, SessionEntityCandidate>
	): ResolutionCandidate[] =>
		[...sessionCandidates.values()]
			.filter(({ type }) => type === occurrence.mention.type)
			.map((candidate) => ({
				targetId: candidate.targetId,
				title: candidate.title,
				type: candidate.type,
				context: candidate.contexts.join('\n\n').slice(0, 1_600),
				candidate
			}))

	const buildModelResolutionRequests = (
		occurrences: MentionOccurrence[],
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
					mention: occurrence.mention.mention,
					type: occurrence.mention.type,
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
					mention: request.occurrence.mention,
					document: document as VaultDocument & { currentRevisionId: string },
					method: 'model'
				})
				continue
			}
			resolutions.set(request.occurrence.referenceId, {
				kind: 'session',
				mention: request.occurrence.mention,
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
				mention: request.occurrence.mention,
				match: { kind: 'unresolved', candidates },
				canCreate: canCreateEntityFromMention(request.occurrence.mention)
			})
		}
	}

	const attachResolutionsToClaims = (
		claims: ValidatedClaim[],
		occurrences: MentionOccurrence[],
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
		const occurrences = createMentionOccurrences(claims, documents)
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
		'Extract atomic campaign claims from the transcript. Claims describe evidence, not how Lore should be stored: do not invent document titles or choose destination documents. Every claim must quote an exact excerpt and its content must be directly supported by that excerpt. Mark interpretation as inferred and mere names as mentions. For entityMentions, include each distinct campaign entity referred to by the claim. The mention must be copied from the excerpt, use the shortest identifying name or phrase, and describe the entity type rather than the claim. Prefer an explicit name or alias when one appears. Relational phrases such as "Elias\' father" are allowed when that is how the source identifies the entity. Never turn a property or topic into an entity: for "Mara\'s age", mention "Mara", not "Mara\'s age". Do not invent, paraphrase, or combine evidence.'
	const validationSystem =
		'Independently verify candidate campaign claims against the transcript. Return only candidates whose content is strictly supported by the quoted evidence in context. Copy every accepted candidate exactly, including entityMentions; the only field you may change is certainty, and only from explicit to inferred. Never add or rewrite claims or entity mentions. Reject candidates that add unsupported motive, causality, chronology, identity, relationships, current state, or other details; that turn a character claim into objective truth; that remove material uncertainty or attribution; or whose evidence supports only a weaker or different statement.'

	const transcriptChunkPrompt = (chunk: TranscriptChunk) =>
		`## Transcript chunk ${chunk.chunkId}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${chunk.content}`

	const evidenceBackedClaims = (
		transcript: string,
		chunk: TranscriptChunk,
		claims: ExtractedSessionClaim[]
	) => {
		const backed: EvidenceBackedClaim[] = []
		const warnings: string[] = []
		for (const [claimIndex, originalClaim] of claims.entries()) {
			const evidence = locateEvidence(transcript, chunk, originalClaim.excerpt)
			if (!evidence) {
				warnings.push(
					`${chunk.chunkId} claim ${claimIndex + 1} was discarded because its evidence was absent or ambiguous.`
				)
				continue
			}
			const validMentions = originalClaim.entityMentions.filter(({ mention }) =>
				mentionIsInExcerpt(mention, evidence.excerpt)
			)
			const omittedCount = originalClaim.entityMentions.length - validMentions.length
			if (omittedCount) {
				warnings.push(
					`${chunk.chunkId} claim ${claimIndex + 1} omitted ${omittedCount} entity mention${omittedCount === 1 ? '' : 's'} that ${omittedCount === 1 ? 'was' : 'were'} not present in its evidence.`
				)
			}
			backed.push({
				claimIndex,
				claim: { ...originalClaim, entityMentions: uniqueEntityMentions(validMentions) },
				evidence
			})
		}
		return { claims: backed, warnings }
	}

	const validationPrompt = (chunk: TranscriptChunk, claims: EvidenceBackedClaim[]) =>
		`${transcriptChunkPrompt(chunk)}\n\n## Candidate claims\n${JSON.stringify(
			claims.map(({ claim }) => claim),
			null,
			2
		)}`

	const applyClaimValidation = (
		chunk: TranscriptChunk,
		backedClaims: EvidenceBackedClaim[],
		validatedClaims: ExtractedSessionClaim[]
	) => {
		const validatedCertaintyByKey = validationCertainties(validatedClaims)
		const claims: ValidatedClaim[] = []
		const warnings: string[] = []
		for (const { claimIndex, claim, evidence } of backedClaims) {
			const validationCertainty = validatedCertaintyByKey.get(validationClaimKey(claim))
			if (!validationCertainty) {
				warnings.push(
					`${chunk.chunkId} claim ${claimIndex + 1} was discarded because model validation did not confirm it.`
				)
				continue
			}
			claims.push({
				...claim,
				certainty:
					claim.certainty === 'inferred' || validationCertainty === 'inferred'
						? 'inferred'
						: 'explicit',
				claimId: randomUUID(),
				evidence: [evidence]
			})
		}
		return { claims, warnings }
	}

	const analyzeChunk = (transcript: string, chunk: TranscriptChunk) =>
		gen(function* () {
			const extracted = yield* ai.analyzeSessionChunk({
				model: ai.analysisModel,
				system: extractionSystem,
				prompt: transcriptChunkPrompt(chunk)
			})
			const backed = evidenceBackedClaims(transcript, chunk, extracted)
			if (!backed.claims.length)
				return { claims: [] as ValidatedClaim[], warnings: backed.warnings }
			const validated = yield* ai.analyzeSessionChunk({
				model: ai.analysisModel,
				system: validationSystem,
				prompt: validationPrompt(chunk, backed.claims)
			})
			const applied = applyClaimValidation(chunk, backed.claims, validated)
			return {
				claims: applied.claims,
				warnings: [...backed.warnings, ...applied.warnings]
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
		const createPaths = new Set<string>()
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
			const path = `${categoryDirectory[proposal.documentType]}/${toSlug(proposal.title)}.md`
			if (createPaths.has(path) || documents.some((document) => document.path === path)) {
				return failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'duplicateDocumentPath', path }
				} satisfies Failure)
			}
			createPaths.add(path)
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
