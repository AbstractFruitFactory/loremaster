import type { Effect } from 'effect/Effect'
import type { DocumentType } from '../../document.js'
import type { AssistantGeneration, AssistantGenerationEvent } from '../assistant/types.js'
import type { Failure } from '../failure.js'
import type {
	ExtractedSessionClaim,
	InferredCampaignImportChronology,
	InferredSessionChronology,
	SessionEventAudit,
	SessionClaimEvidenceRepair,
	SessionClaimValidation,
	SessionEntityResolution,
	SessionEntityResolutionRequest
} from '../ingestion/types.js'
import type { RelationshipLink } from '../vault/types.js'

export const EMBEDDING_DIMENSIONS = 1536

export type AiPrompt = {
	system?: string
	prompt: string
}

export type GenerateText = (
	input: AiPrompt & { model: string }
) => Effect<string, Failure<'ai', 'generateText'>>

export type GenerateAssistant = (
	input: AiPrompt & { model: string }
) => Effect<AssistantGeneration, Failure<'ai', 'generateAssistant'>>

export type StreamAssistant = (
	input: AiPrompt & { model: string; signal?: AbortSignal }
) => Effect<AsyncIterable<AssistantGenerationEvent>, Failure<'ai', 'streamAssistant'>>

export type EmbedTexts = (input: {
	model: string
	values: string[]
}) => Effect<number[][], Failure<'ai', 'embedTexts'>>

export type InferDocumentType = (input: {
	model: string
	path: string
	title: string
	content: string
}) => Effect<DocumentType, Failure<'ai', 'inferDocumentType'>>

export type AnalyzeSessionChunk = (
	input: AiPrompt & { model: string }
) => Effect<ExtractedSessionClaim[], Failure<'ai', 'analyzeSessionChunk'>>

export type ValidateSessionClaims = (
	input: AiPrompt & { model: string }
) => Effect<SessionClaimValidation[], Failure<'ai', 'validateSessionClaims'>>

export type RepairSessionClaimEvidence = (
	input: AiPrompt & { model: string }
) => Effect<SessionClaimEvidenceRepair[], Failure<'ai', 'repairSessionClaimEvidence'>>

export type ResolveSessionEntities = (input: {
	model: string
	references: SessionEntityResolutionRequest[]
}) => Effect<SessionEntityResolution[], Failure<'ai', 'resolveSessionEntities'>>

export type AuditSessionEvents = (
	input: AiPrompt & { model: string }
) => Effect<SessionEventAudit, Failure<'ai', 'auditSessionEvents'>>

export type InferSessionChronology = (
	input: AiPrompt & { model: string }
) => Effect<InferredSessionChronology, Failure<'ai', 'inferSessionChronology'>>

export type InferCampaignImportChronology = (
	input: AiPrompt & { model: string }
) => Effect<InferredCampaignImportChronology, Failure<'ai', 'inferCampaignImportChronology'>>

export type GenerateRelationshipLinks = (
	input: AiPrompt & { model: string }
) => Effect<RelationshipLink[], Failure<'ai', 'generateRelationshipLinks'>>

export type AiModels = {
	assistant: string
	campaignSummary: string
	documentSummary: string
	documentType: string
	entityResolution: string
	sessionAnalysis: string
	relationshipLinks: string
	embeddings: string
}

export type AiProvider = {
	models: AiModels
	generateText: GenerateText
	generateAssistant: GenerateAssistant
	streamAssistant: StreamAssistant
	embedTexts: EmbedTexts
	inferDocumentType: InferDocumentType
	analyzeSessionChunk: AnalyzeSessionChunk
	validateSessionClaims: ValidateSessionClaims
	repairSessionClaimEvidence: RepairSessionClaimEvidence
	resolveSessionEntities: ResolveSessionEntities
	auditSessionEvents: AuditSessionEvents
	inferSessionChronology: InferSessionChronology
	inferCampaignImportChronology: InferCampaignImportChronology
	generateRelationshipLinks: GenerateRelationshipLinks
}

export type AiOperation = Exclude<keyof AiProvider, 'models'>

export type AiModel<Operation extends AiOperation> = Pick<AiProvider, Operation> & {
	model: string
}
