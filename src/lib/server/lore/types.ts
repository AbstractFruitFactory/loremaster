import type { DocumentType } from '../../document'

export type LoreSummary = {
	id: string
	title: string
	category: DocumentType
}

export type LoreEntry = LoreSummary & {
	content: string
	links: string[]
}
