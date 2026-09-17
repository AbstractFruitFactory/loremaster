import type { DocumentType } from '../../document'

export type LoreSummary = {
	id: string
	title: string
	category: DocumentType
	summary: string
}

export type LoreEntry = LoreSummary & {
	content: string
	links: string[]
}
