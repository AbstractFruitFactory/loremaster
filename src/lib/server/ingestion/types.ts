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

export type ExtractedSessionClaim = {
	excerpt: string
	title: string
	documentType: IngestionDocumentType
	kind: SessionClaimKind
	certainty: 'explicit' | 'inferred'
	content: string
	references: string[]
	after: string[]
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
	operation: 'create-entity' | 'create-event' | 'update-canon' | 'mention-only'
	documentType: DocumentType
	title: string
	certainty: 'explicit' | 'inferred'
	selected: boolean
	evidence: Evidence[]
	match: ProposalMatch
	references: ProposalReference[]
	after: ProposalReference[]
	content: string
	base?: { documentId: string; revisionId: string }
	patch?: CanonPatch
}

export type SessionIngestionDraft = {
	schemaVersion: 1
	ingestionId: string
	campaignId: string
	title: string
	createdAt: string
	warnings: string[]
	proposals: SessionProposal[]
}
