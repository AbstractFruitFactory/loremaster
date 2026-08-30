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

export type AssistantResponse = AssistantGeneration & {
	sources: LoreSource[]
}
