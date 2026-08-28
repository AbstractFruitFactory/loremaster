export type VaultFrontmatter = {
	id?: string
	type?: string
	aliases?: string[]
}

export type VaultDocument = {
	id: string
	path: string
	title: string
	type?: string
	aliases?: string[]
	content: string
	links: string[]
}

export type VaultDocumentSummary = Omit<VaultDocument, 'content'>

export type ParsedVaultDocument = Omit<VaultDocument, 'id'> & {
	id?: string
}

export type CreateVaultDocumentInput = {
	path: string
	type?: string
	aliases?: string[]
	content: string
}

export type UpdateVaultDocumentInput = {
	type?: string
	aliases?: string[]
	content: string
}

export type VaultLinkIndex = {
	targetName: string
	targetDocumentId: string | null
}

export type VaultDocumentIndex = Pick<VaultDocument, 'id' | 'path' | 'title' | 'type' | 'links'>
