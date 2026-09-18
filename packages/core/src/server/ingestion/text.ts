import type { VaultDocument } from '../vault/types.js'
import type { EntityReference, Evidence, SessionProposal } from './types.js'

export const categoryDirectory: Record<VaultDocument['type'], string> = {
	player: 'Players',
	npc: 'NPCs',
	location: 'Locations',
	session: 'Sessions',
	item: 'Items',
	worldbuilding: 'Worldbuilding',
	event: 'Events'
}

export const toSlug = (title: string) =>
	title
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-|-$/g, '') || 'document'

export const normalize = (value: string) => value.trim().toLocaleLowerCase()

export const displayTitle = (title: string) => {
	const value = title.trim().replace(/\s+/g, ' ')
	const firstLetter = value.match(/\p{L}/u)
	if (!firstLetter || firstLetter.index === undefined) return value
	const index = firstLetter.index
	const letter = firstLetter[0]
	return `${value.slice(0, index)}${letter.toLocaleUpperCase()}${value.slice(index + letter.length)}`
}

export const wordTokens = (value: string) => normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []

export const uniqueStrings = (values: string[]) => [
	...new Map(values.map((value) => [normalize(value), value])).values()
]

export const uniqueEvidence = (evidence: Evidence[]) => [
	...new Map(
		evidence.map((item) => [`${item.startStringIndex}:${item.endStringIndex}`, item])
	).values()
]

export const uniqueEntityReferences = (references: EntityReference[]) => {
	const unique = new Map<string, EntityReference>()
	for (const reference of references) {
		const key = `${reference.type}:${normalize(reference.label)}`
		const existing = unique.get(key)
		if (!existing || reference.role === 'subject') unique.set(key, reference)
	}
	return [...unique.values()]
}

export const entityReferenceId = (candidateId: string, index: number) =>
	`${candidateId}:reference-${index + 1}`

export const uniqueReferences = (references: SessionProposal['references']) => [
	...new Map(
		references.map((reference) => [
			reference.documentId ? `id:${reference.documentId}` : `label:${normalize(reference.label)}`,
			reference
		])
	).values()
]

export const combineContent = (contents: string[]) =>
	uniqueStrings(contents.map((content) => content.trim()).filter(Boolean)).join('\n\n')
