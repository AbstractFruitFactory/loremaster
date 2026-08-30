import type { Effect } from 'effect/Effect'
import type { DocumentType } from '../../document'
import type { AssistantGeneration } from '../assistant/types'
import type { Failure } from '../failure'

export const EMBEDDING_DIMENSIONS = 64

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

export type AiProvider = {
	generateText: GenerateText
	generateAssistant: GenerateAssistant
	embedTexts: EmbedTexts
	inferDocumentType: InferDocumentType
}

export type AiModel<Operation extends keyof AiProvider> = Pick<AiProvider, Operation> & {
	model: string
}
