import type { DocumentType } from '../../document'

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

export type InferredSessionChronology = {
	relation: 'before' | 'during'
	sourceEventId: string
	targetEventId: string
	certainty: 'explicit' | 'inferred'
	reason: string
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
	InferredSessionChronology,
	'sourceEventId' | 'targetEventId'
> & {
	chronologyId: string
	selected: boolean
	source: SessionChronologyEndpoint
	target: SessionChronologyEndpoint
}

export type SessionProposalResolution =
	| { proposalId: string; kind: 'create' }
	| { proposalId: string; kind: 'existing'; documentId: string }

export type SessionIngestionDraft = {
	schemaVersion: 2
	ingestionId: string
	campaignId: string
	title: string
	createdAt: string
	warnings: string[]
	proposals: SessionProposal[]
	chronology: SessionChronologyProposal[]
}

export type SessionIngestionResult = {
	sessionDocumentId: string
	documents: { proposalId: string; documentId: string; documentType: DocumentType }[]
}
