import { map } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { DocumentType } from '../../document'
import type { vaultOperations } from '../vault/operations'
import type { VaultDocument, VaultDocumentSummary } from '../vault/types'
import type { LoreEntry, LoreSummary } from './types'

const categoryDirectory: Record<DocumentType, string> = {
	player: 'Players',
	npc: 'NPCs',
	location: 'Locations',
	session: 'Sessions',
	item: 'Items',
	lore: 'Lore',
	event: 'Events'
}

const toSlug = (title: string) =>
	title
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-|-$/g, '') || 'lore'

const toLoreSummary = (document: VaultDocumentSummary): LoreSummary => ({
	id: document.id,
	title: document.title,
	category: document.type,
	summary: document.summary
})

const toLoreEntry = (document: VaultDocument): LoreEntry => ({
	...toLoreSummary(document),
	content: document.content.replace(/^#\s+.*(?:\r?\n|$)/, '').replace(/^\r?\n/, ''),
	links: document.links
})

export const loreOperations = ({ vault }: {
	vault: Pick<
		ReturnType<typeof vaultOperations>,
		'createDocument' | 'getDocument' | 'listDocuments'
	>
}) => {
	const listLore = (campaignId: string) =>
		pipe(
			vault.listDocuments(campaignId),
			map((documents) =>
				documents.map(toLoreSummary).sort((left, right) => left.title.localeCompare(right.title))
			)
		)

	const getLore = (campaignId: string, loreId: string) =>
		pipe(vault.getDocument(campaignId, loreId), map(toLoreEntry))

	const createLore = (
		campaignId: string,
		input: {
			title: string
			category: DocumentType
			content: string
		}
	) =>
		pipe(
			vault.createDocument(campaignId, {
				path: `${categoryDirectory[input.category]}/${toSlug(input.title)}.md`,
				type: input.category,
				content: `# ${input.title.trim()}\n\n${input.content.trim()}`
			}),
			map(toLoreEntry)
		)

	return { createLore, getLore, listLore }
}
