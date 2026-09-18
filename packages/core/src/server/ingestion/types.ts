import type { DocumentType } from '../../document.js'

export const ingestionDocumentTypes = [
	'player',
	'npc',
	'location',
	'item',
	'worldbuilding',
	'event'
] as const

export type IngestionDocumentType = (typeof ingestionDocumentTypes)[number]

export type SessionClaimKind = 'stable-fact' | 'development' | 'mention'

export type EvidenceRange = {
	startLine: number
	endLine: number
}

export type EntityReference = {
	label: string
	type: IngestionDocumentType
}

export type ExtractedSessionClaim = {
	kind: SessionClaimKind
	eventTitle: string | null
	certainty: 'explicit' | 'inferred'
	content: string
	evidence: EvidenceRange[]
	entityReferences: EntityReference[]
}

export type SessionValidatedClaim = Omit<ExtractedSessionClaim, 'evidence'> & {
	claimId: string
	evidence: Evidence[]
}

export type SessionAnalysisStageResult = {
	claims: SessionValidatedClaim[]
	warnings: string[]
}

export type SessionProposalBuildResult = {
	claims: SessionValidatedClaim[]
	proposals: SessionProposal[]
}

export type SessionChronologyStageResult = {
	chronology: SessionChronologyProposal[]
	coverage: SessionChronologyCoverageProposal[]
	warnings: string[]
}

export type SessionEntityReferenceValidation = {
	referenceId: string
	accepted: boolean
}

export const sessionClaimValidationReasons = [
	'supported',
	'insufficient-evidence',
	'contradicted-by-evidence',
	'unsupported-inference',
	'lost-attribution'
] as const

export type SessionClaimValidationReason = (typeof sessionClaimValidationReasons)[number]

export type SessionClaimValidation = {
	candidateId: string
	accepted: boolean
	certainty: 'explicit' | 'inferred'
	reason?: SessionClaimValidationReason
	referenceValidations: SessionEntityReferenceValidation[]
}

export type SessionClaimEvidenceRepair = {
	candidateId: string
	evidence: EvidenceRange[]
}

export type SessionEntityResolution = {
	referenceId: string
	targetId: string | null
}

export type SessionEventAudit = {
	events: ExtractedSessionClaim[]
	discardedEventIds: { eventId: string; reason: string }[]
	duplicateGroups: {
		canonicalEventId: string
		duplicateEventIds: string[]
		reason: string
	}[]
}

export type InferredSessionChronologyRelation = {
	relation: 'before' | 'during'
	sourceEventId: string
	targetEventId: string
	certainty: 'explicit' | 'inferred'
	reason: string
}

export type InferredSessionChronologyCoverage = {
	eventId: string
	status: 'connected' | 'intentionally-unplaced'
	reason: string
}

export type InferredSessionChronology = {
	relations: InferredSessionChronologyRelation[]
	coverage: InferredSessionChronologyCoverage[]
}

export type TranscriptChunk = {
	chunkId: string
	content: string
	startStringIndex: number
	endStringIndex: number
	startLine: number
	endLine: number
}

export type Evidence = {
	excerpt: string
	chunkId: string
	startStringIndex: number
	endStringIndex: number
	startLine: number
	endLine: number
}

export type ProposalCandidate = {
	documentId: string
	revisionId: string
	title: string
	documentType: DocumentType
	score: number
}

export type ProposalMatch =
	| { kind: 'exact'; documentId: string; title: string; documentType: DocumentType }
	| { kind: 'unresolved'; candidates: ProposalCandidate[] }

export type ProposalReference = {
	label: string
	documentId?: string
}

export type CanonPatch = {
	kind: 'append'
	content: string
}

export type SessionProposal = {
	proposalId: string
	claimIds: string[]
	groupId?: string
	operation: 'create-entity' | 'create-event' | 'update-canon' | 'mention-only' | 'record-only'
	documentType: DocumentType
	title: string
	certainty: 'explicit' | 'inferred'
	selected: boolean
	evidence: Evidence[]
	match: ProposalMatch
	references: ProposalReference[]
	content: string
	resolutionMethod?: 'deterministic' | 'model'
	canCreate?: boolean
	base?: { documentId: string; revisionId: string }
	patch?: CanonPatch
}

export type SessionChronologyEndpoint = {
	eventId: string
	title: string
	source: 'proposal' | 'existing'
}

export type SessionChronologyProposal = Omit<
	InferredSessionChronologyRelation,
	'sourceEventId' | 'targetEventId'
> & {
	chronologyId: string
	selected: boolean
	source: SessionChronologyEndpoint
	target: SessionChronologyEndpoint
}

export type SessionChronologyCoverageProposal = {
	event: SessionChronologyEndpoint
	status: 'connected' | 'intentionally-unplaced' | 'missing'
	reason: string
}

export type SessionProposalResolution =
	| { proposalId: string; kind: 'create' }
	| { proposalId: string; kind: 'existing'; documentId: string }

export type SessionIngestionAnalyzeInput = {
	ingestionId?: string
	campaignId: string
	title: string
	transcript: string
}

export type SessionTranscriptData = {
	schemaVersion: 1
	ingestionId: string
	campaignId: string
	title: string
	transcript: string
}

export type SessionIngestionDraft = {
	schemaVersion: 3
	ingestionId: string
	campaignId: string
	title: string
	createdAt: string
	warnings: string[]
	proposals: SessionProposal[]
	chronology: SessionChronologyProposal[]
	chronologyCoverage: SessionChronologyCoverageProposal[]
}

export type SessionIngestionPhase = 'analyzing' | 'review' | 'committing'

export type SessionIngestionSummary = {
	ingestionId: string
	campaignId: string
	title: string
	createdAt: string
	phase: SessionIngestionPhase
	canDiscard: boolean
}

export type SessionIngestionResult = {
	sessionDocumentId: string
	documents: { proposalId: string; documentId: string; documentType: DocumentType }[]
}

export type SessionCommitData = {
	schemaVersion: 1
	campaignId: string
	ingestionId: string
	selectedProposalIds: string[]
	selectedChronologyIds?: string[]
	resolutions?: SessionProposalResolution[]
}

export type SessionCommitMutationResult = {
	mutationId: string
	documentId: string
	proposalId?: string
	documentType?: DocumentType
}

export type SessionCommitJournal = {
	schemaVersion: 1
	campaignId: string
	ingestionId: string
	applied: Record<string, SessionCommitMutationResult>
}
