import type { DocumentType } from '../../document'

export type VaultFrontmatter = {
	id?: string
	type?: DocumentType
	aliases?: string[]
	after?: string[]
	ingestionId?: string
}

export type VaultDocument = {
	id: string
	path: string
	title: string
	type: DocumentType
	aliases?: string[]
	after: string[]
	summary: string
	content: string
	transcript?: string
	ingestionId?: string
	links: string[]
	currentRevisionId?: string
}

export type VaultDocumentSummary = Omit<VaultDocument, 'content' | 'transcript'>

export type ParsedVaultDocument = Omit<VaultDocument, 'id' | 'type'> & {
	id?: string
	type?: DocumentType
}

export type VaultLinkIndex = {
	targetName: string
	targetDocumentId: string | null
}

export type RelationshipLink = {
	targetDocumentId: string
	relationship: string
}

export type VaultDocumentIndex = Pick<
	VaultDocument,
	'id' | 'path' | 'title' | 'type' | 'after' | 'links' | 'summary'
>
