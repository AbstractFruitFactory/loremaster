import type { DocumentType } from '../../document.js'
import type { MutationPlan } from './internal.js'
import type { EventForm } from '../vault/types.js'

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
	role: 'subject' | 'related'
	eventForm?: EventForm | null
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

export type SessionEntityResolution =
	| {
			referenceId: string
			kind: 'existing'
			targetId: string
	  }
	| {
			referenceId: string
			kind: 'create'
	  }
	| {
			referenceId: string
			kind: 'defer'
			candidateIds: string[]
			reason: string
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

export type InferredCampaignImportChronologyRelation = InferredSessionChronologyRelation & {
	claimIds: string[]
}

export type InferredCampaignImportChronology = {
	relations: InferredCampaignImportChronologyRelation[]
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
	sourceId?: string
	sourceRevisionId?: string
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
	eventForm?: EventForm
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

export type CampaignImportSourceMediaType = 'text/markdown' | 'text/plain'

export type CampaignImportSourceInput = {
	displayName: string
	title: string
	mediaType: CampaignImportSourceMediaType
	content: string
}

export type CampaignImportSource = Omit<CampaignImportSourceInput, 'content'> & {
	sourceId: string
	sourceRevisionId: string
	contentHash: string
	byteLength: number
}

export type CampaignImportSourceData = CampaignImportSource & {
	content: string
}

export type CampaignImportAnalyzeInput = {
	ingestionId?: string
	campaignId: string
	sources: CampaignImportSourceInput[]
}

export type CampaignImportRequestData = {
	schemaVersion: 1
	kind: 'campaign-import'
	ingestionId: string
	campaignId: string
	createdAt: string
	sources: CampaignImportSource[]
}

export type CampaignImportEvidence = Evidence & {
	sourceId: string
	sourceRevisionId: string
}

export type CampaignImportClaim = Omit<SessionValidatedClaim, 'evidence'> & {
	evidence: CampaignImportEvidence[]
	claimFingerprint: string
}

export type CampaignImportDraft = {
	schemaVersion: 1
	kind: 'campaign-import'
	ingestionId: string
	campaignId: string
	createdAt: string
	sources: CampaignImportSource[]
	claims: CampaignImportClaim[]
	temporalClaims: CampaignImportClaim[]
	proposals: SessionProposal[]
	warnings: string[]
}

export type CampaignImportProposalResolution =
	| { proposalId: string; kind: 'create' }
	| { proposalId: string; kind: 'existing'; documentId: string }

export type CampaignImportReviewState = {
	schemaVersion: 1
	campaignId: string
	ingestionId: string
	revision: number
	updatedAt: string
	selectedProposalIds: string[]
	resolutions: CampaignImportProposalResolution[]
}

export type CampaignImportReviewUpdateInput = {
	campaignId: string
	ingestionId: string
	expectedRevision: number
	selectedProposalIds: string[]
	resolutions: CampaignImportProposalResolution[]
}

export const MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS = 500

export type CampaignImportCommitInput = {
	campaignId: string
	ingestionId: string
	expectedReviewRevision: number
	selectedProposalIds: string[]
	resolutions?: CampaignImportProposalResolution[]
}

export type CampaignImportCommitData = CampaignImportCommitInput & {
	schemaVersion: 1
	kind: 'campaign-import-commit'
}

export type CampaignImportCommitPlanData = {
	schemaVersion: 1
	kind: 'campaign-import-commit-plan'
	campaignId: string
	ingestionId: string
	resolvedSelected: SessionProposal[]
	plan: MutationPlan
}

export type CampaignImportCommitResult = {
	documents: { proposalId: string; documentId: string; documentType: DocumentType }[]
	finalized: boolean
}

export type CampaignImportCompletionData = CampaignImportCommitResult & {
	schemaVersion: 1
	kind: 'campaign-import-completion'
	campaignId: string
	ingestionId: string
}

export type CampaignImportChronologyProposal = SessionChronologyProposal & {
	supportingClaimIds: string[]
	evidence: CampaignImportEvidence[]
}

export type CampaignImportChronologyDraft = {
	schemaVersion: 1
	kind: 'campaign-import-chronology'
	campaignId: string
	ingestionId: string
	createdAt: string
	chronology: CampaignImportChronologyProposal[]
	chronologyCoverage: SessionChronologyCoverageProposal[]
	warnings: string[]
}

export type CampaignImportChronologyCommitInput = {
	campaignId: string
	ingestionId: string
	selectedChronologyIds: string[]
}

export type CampaignImportChronologyCommitData = CampaignImportChronologyCommitInput & {
	schemaVersion: 1
	kind: 'campaign-import-chronology-commit'
}

export type CampaignImportChronologyCommitPlanData = {
	schemaVersion: 1
	kind: 'campaign-import-chronology-commit-plan'
	campaignId: string
	ingestionId: string
	selectedChronology: CampaignImportChronologyProposal[]
	plan: MutationPlan
}

export type CampaignImportChronologyCommitResult = {
	updatedDocumentIds: string[]
	finalized: boolean
}

export type CampaignImportChronologyCommittedCompletionData =
	CampaignImportChronologyCommitResult & {
		schemaVersion: 1
		kind: 'campaign-import-chronology-completion'
		campaignId: string
		ingestionId: string
	}

export type CampaignImportChronologyNoRelationsData = {
	schemaVersion: 1
	kind: 'campaign-import-chronology-no-relations'
	campaignId: string
	ingestionId: string
	updatedDocumentIds: []
	finalized: true
}

export type CampaignImportChronologyCompletionData =
	CampaignImportChronologyCommittedCompletionData | CampaignImportChronologyNoRelationsData

export type CampaignImportChronologyBuildResult = {
	draft: CampaignImportChronologyDraft
	outcome?: CampaignImportChronologyNoRelationsData
}

export type CampaignImportChronologyDispatchData = {
	schemaVersion: 1
	kind: 'campaign-import-chronology-dispatch'
	campaignId: string
	ingestionId: string
	status: 'dispatched' | 'failed'
	updatedAt: string
	error?: {
		code: string
		message: string
	}
}

export type CampaignImportPhase =
	| 'analyzing'
	| 'review'
	| 'committing'
	| 'chronology-analyzing'
	| 'chronology-review'
	| 'chronology-committing'
	| 'ready-to-finish'
	| 'failed'

export type CampaignImportSummary = {
	ingestionId: string
	campaignId: string
	createdAt: string
	phase: CampaignImportPhase
	canDiscard: boolean
}

export type CampaignImportLifecycleStorageState = {
	request: CampaignImportRequestData
	draft?: CampaignImportDraft
	commitRequested: boolean
	completion?: CampaignImportCompletionData
	chronologyDispatch?: CampaignImportChronologyDispatchData
	chronologyDraft?: CampaignImportChronologyDraft
	chronologyCommitData?: CampaignImportChronologyCommitData
	chronologyCompletion?: CampaignImportChronologyCompletionData
}

export type CampaignImportSourceAnalysis = {
	sourceId: string
	sourceRevisionId: string
	claims: CampaignImportClaim[]
	warnings: string[]
}

export type CampaignImportClaimProvenanceRecord = {
	claim: CampaignImportClaim
	source: CampaignImportSource
	documentId: string
	vaultRevisionId: string
	evidence: CampaignImportEvidence
}

export type CampaignImportChronologyProvenanceRecord = {
	chronologyId: string
	relation: 'before' | 'during'
	sourceEventId: string
	targetEventId: string
	affectedDocumentId: string
	vaultRevisionId: string
	claim: CampaignImportClaim
	source: CampaignImportSource
	evidence: CampaignImportEvidence
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
	revisionId?: string
}

export type SessionCommitJournal = {
	schemaVersion: 1
	campaignId: string
	ingestionId: string
	applied: Record<string, SessionCommitMutationResult>
}
