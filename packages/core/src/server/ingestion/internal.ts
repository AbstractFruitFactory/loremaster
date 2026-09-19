import type { VaultDocument } from '../vault/types.js'
import type { CandidateProvenance } from './matching.js'
import type {
	EntityReference,
	Evidence,
	ExtractedSessionClaim,
	IngestionDocumentType,
	ProposalCandidate,
	ProposalMatch,
	SessionValidatedClaim,
	SessionProposal,
	SessionProposalResolution,
	TranscriptChunk
} from './types.js'

export type ValidatedClaim = SessionValidatedClaim

export type EvidenceBackedClaim = {
	candidateId: string
	claimIndex: number
	claim: ExtractedSessionClaim
	evidence: Evidence[]
}

export type SessionEntityCandidate = {
	targetId: string
	title: string
	type: IngestionDocumentType
	contexts: string[]
}

export type EntityResolution =
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

export type ResolvedClaim = ValidatedClaim & {
	entities: EntityResolution[]
	event?: EntityResolution
}

export type EntityReferenceOccurrence = {
	referenceId: string
	purpose: 'entity-reference' | 'development-event'
	claim: ValidatedClaim
	reference: EntityReference
	match: ProposalMatch
}

export type ResolutionCandidate = {
	targetId: string
	title: string
	type: IngestionDocumentType
	context: string
	provenance: CandidateProvenance | 'session-entity'
	candidate: ProposalCandidate | SessionEntityCandidate
}

export type ModelResolutionRequest = {
	occurrence: EntityReferenceOccurrence
	context: string
	candidates: ResolutionCandidate[]
}

export type { TranscriptChunk }

export type CommitInput = {
	campaignId: string
	ingestionId: string
	selectedProposalIds: string[]
	selectedChronologyIds?: string[]
	resolutions?: SessionProposalResolution[]
}

export type PlannedMutation = {
	mutationId: string
	proposal: SessionProposal
	documentId: string
	path?: string
	after?: string[]
	during?: string[]
	eventForm?: VaultDocument['eventForm']
}

export type MutationPlan = {
	planned: PlannedMutation[]
	chronologyUpdates: {
		mutationId: string
		documentId: string
		after: string[]
		during: string[]
		eventForm: VaultDocument['eventForm']
	}[]
	documentIdByProposal: Record<string, string>
	existingById: Record<string, VaultDocument>
	sessionDocumentId?: string
}
