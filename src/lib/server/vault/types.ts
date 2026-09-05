import type { DocumentType } from '../../document'

export type VaultFrontmatter = {
	id?: string
	type?: DocumentType
	aliases?: string[]
	after?: string[]
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
	links: string[]
	sourceHash?: string
	currentRevisionId?: string
}

export type VaultDocumentSummary = Omit<VaultDocument, 'content'>

export type ParsedVaultDocument = Omit<VaultDocument, 'id' | 'type'> & {
	id?: string
	type?: DocumentType
}

export type VaultLinkIndex = {
	targetName: string
	targetDocumentId: string | null
}

export type VaultDocumentIndex = Pick<
	VaultDocument,
	'id' | 'path' | 'title' | 'type' | 'after' | 'links' | 'summary'
>
