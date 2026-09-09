import type { DocumentType } from '../../document'
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

export type AssistantGenerationEvent =
	{ type: 'text-delta'; delta: string } | { type: 'proposal'; proposal: LoreProposal }

export type AssistantResponse = AssistantGeneration & {
	sources: LoreSource[]
}

export type AssistantStream = {
	events: AsyncIterable<AssistantGenerationEvent>
	sources: LoreSource[]
}

export type AssistantStreamEvent =
	| { type: 'sources'; sources: LoreSource[] }
	| AssistantGenerationEvent
	| { type: 'done' }
	| { type: 'error'; message: string }
