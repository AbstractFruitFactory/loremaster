import type { DocumentType } from '../../document'

export const ingestionDocumentTypes = [
	'player',
	'npc',
	'location',
	'item',
	'lore',
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
	certainty: 'explicit' | 'inferred'
	content: string
	evidence: EvidenceRange[]
	entityReferences: EntityReference[]
}

export type SessionEntityReferenceValidation = {
	referenceId: string
	accepted: boolean
}

export type SessionClaimValidation = {
	candidateId: string
	accepted: boolean
	certainty: 'explicit' | 'inferred'
	referenceValidations: SessionEntityReferenceValidation[]
}

export type SessionEntityResolution = {
	referenceId: string
	targetId: string | null
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
	after: ProposalReference[]
	content: string
	resolutionMethod?: 'deterministic' | 'model'
	canCreate?: boolean
	base?: { documentId: string; revisionId: string }
	patch?: CanonPatch
}

export type SessionProposalResolution =
	| { proposalId: string; kind: 'create' }
	| { proposalId: string; kind: 'existing'; documentId: string }

export type SessionIngestionDraft = {
	schemaVersion: 1
	ingestionId: string
	campaignId: string
	title: string
	createdAt: string
	warnings: string[]
	proposals: SessionProposal[]
}

export type SessionIngestionResult = {
	sessionDocumentId: string
	documents: { proposalId: string; documentId: string; documentType: DocumentType }[]
}
