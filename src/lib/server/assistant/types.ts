import type { Effect } from 'effect/Effect'
import type { DocumentType } from '../../document'
import type { GenerateText } from '../ai/generate'
import type { Failure } from '../failure'
import type { VaultDocument } from '../vault/types'

export type LoreSource = Pick<VaultDocument, 'id' | 'title' | 'type'>

export type LoreProposal = {
	title: string
	category: DocumentType
	content: string
}

export type AssistantGeneration = {
	message: string
	proposal?: LoreProposal
}

export type GenerateAssistant = (
	input: Parameters<GenerateText>[0]
) => Effect<AssistantGeneration, Failure<'ai', 'generateAssistant'>>

export type AssistantResponse = AssistantGeneration & {
	sources: LoreSource[]
}
