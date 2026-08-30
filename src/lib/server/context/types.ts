import type { DocumentType } from '../../document'

export type ContextFragment = {
	id: string
	campaignId: string
	documentId: string
	title: string
	documentType: DocumentType
	heading?: string
	content: string
	position: number
	contentHash: string
}

export type ContextReason =
	'direct-mention' | 'lexical-match' | 'semantic-match' | 'wiki-link' | 'backlink'

export type ContextCandidate = {
	fragment: ContextFragment
	score: number
	reasons: ContextReason[]
}

export type ContextSource = {
	fragment: ContextFragment
	aliases?: string[]
}

export type SemanticVectorRecord = {
	fragment: ContextFragment
	embedding: number[]
	model: string
}

export type SemanticSearchResult = {
	fragmentId: string
	score: number
}

export type ContextItem = {
	fragment: ContextFragment
	score: number
	reasons: ContextReason[]
}

export type AssistantContext = {
	items: ContextItem[]
	estimatedTokens: number
}

export type ContextConversationMessage = {
	role: 'user' | 'assistant'
	content: string
}
