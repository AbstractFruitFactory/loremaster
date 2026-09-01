import type { Effect } from 'effect/Effect'
import type { DocumentType } from '../../document'
import type { AssistantGeneration, AssistantGenerationEvent } from '../assistant/types'
import type { Failure } from '../failure'

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

export type AiModels = {
	assistant: string
	campaignSummary: string
	documentSummary: string
	documentType: string
	embeddings: string
}

export type AiProvider = {
	models: AiModels
	generateText: GenerateText
	generateAssistant: GenerateAssistant
	streamAssistant: StreamAssistant
	embedTexts: EmbedTexts
	inferDocumentType: InferDocumentType
}

export type AiOperation = Exclude<keyof AiProvider, 'models'>

export type AiModel<Operation extends AiOperation> = Pick<AiProvider, Operation> & {
	model: string
}
