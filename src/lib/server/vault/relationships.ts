import type { RelationshipLink, VaultDocument } from './types'

export const MAX_RELATIONSHIP_WORDS = 4
export const MAX_RELATIONSHIP_LENGTH = 48

const relationshipDocumentTypes = new Set<VaultDocument['type']>([
	'player',
	'npc',
	'location',
	'item',
	'lore'
])

const genericLeadTokens = new Set([
	'a',
	'an',
	'the',
	'old',
	'young',
	'brother',
	'sister',
	'father',
	'mother',
	'captain',
	'lord',
	'lady',
	'sir',
	'saint',
	'king',
	'queen'
])

const words = (value: string) =>
	value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLocaleLowerCase()
		.match(/[\p{L}\p{N}]+/gu) ?? []

const normalizedWords = (value: string) => words(value).join(' ')

const namesFor = (document: Pick<VaultDocument, 'title' | 'aliases'>) => [
	document.title,
	...(document.aliases ?? [])
]

const containsPhrase = (content: string, phrase: string) => {
	const normalizedPhrase = normalizedWords(phrase)
	if (!normalizedPhrase) return false
	return ` ${normalizedWords(content)} `.includes(` ${normalizedPhrase} `)
}

const distinctiveLeadToken = (name: string) => {
	const nameWords = words(name)
	return nameWords.find((word) => word.length >= 3 && !genericLeadTokens.has(word))
}

const uniqueLeadTokens = (documents: VaultDocument[]) => {
	const owners = new Map<string, Set<string>>()
	for (const document of documents) {
		for (const name of namesFor(document)) {
			const token = distinctiveLeadToken(name)
			if (!token) continue
			const documentIds = owners.get(token) ?? new Set<string>()
			documentIds.add(document.id)
			owners.set(token, documentIds)
		}
	}
	return new Set(
		[...owners.entries()]
			.filter(([, documentIds]) => documentIds.size === 1)
			.map(([token]) => token)
	)
}

const linkMatchesDocument = (link: string, document: VaultDocument) => {
	const normalizedLink = normalizedWords(link)
	return namesFor(document).some((name) => normalizedWords(name) === normalizedLink)
}

export const canHaveRelationshipLinks = (document: Pick<VaultDocument, 'type'>) =>
	relationshipDocumentTypes.has(document.type)

export const relationshipCandidates = (source: VaultDocument, documents: VaultDocument[]) => {
	const eligible = documents.filter(
		(document) => document.id !== source.id && canHaveRelationshipLinks(document)
	)
	const uniqueTokens = uniqueLeadTokens(eligible)
	const contentTokens = new Set(words(source.content))

	return eligible.filter((candidate) => {
		if (source.links.some((link) => linkMatchesDocument(link, candidate))) return true
		if (namesFor(candidate).some((name) => containsPhrase(source.content, name))) return true
		return namesFor(candidate).some((name) => {
			const token = distinctiveLeadToken(name)
			return Boolean(token && uniqueTokens.has(token) && contentTokens.has(token))
		})
	})
}

export const normalizeRelationship = (relationship: string) =>
	relationship.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export const isValidRelationship = (relationship: string) => {
	const normalized = normalizeRelationship(relationship)
	const wordCount = normalized.split(' ').filter(Boolean).length
	return (
		Boolean(normalized) &&
		normalized.length <= MAX_RELATIONSHIP_LENGTH &&
		wordCount <= MAX_RELATIONSHIP_WORDS
	)
}

export const validateRelationshipLinks = (
	links: RelationshipLink[],
	candidates: Pick<VaultDocument, 'id'>[]
): RelationshipLink[] => {
	const candidateIds = new Set(candidates.map(({ id }) => id))
	const validated = new Map<string, RelationshipLink>()

	for (const link of links) {
		const relationship = normalizeRelationship(link.relationship)
		if (!candidateIds.has(link.targetDocumentId) || !isValidRelationship(relationship)) continue
		const key = `${link.targetDocumentId}:${relationship}`
		validated.set(key, { targetDocumentId: link.targetDocumentId, relationship })
	}

	return [...validated.values()]
}

export const relationshipPrompt = (source: VaultDocument, candidates: VaultDocument[]) =>
	JSON.stringify(
		{
			source: {
				documentId: source.id,
				title: source.title,
				type: source.type,
				content: source.content
			},
			candidates: candidates.map(({ id, title, type, aliases }) => ({
				documentId: id,
				title,
				type,
				aliases: aliases ?? []
			}))
		},
		null,
		2
	)

export const relationshipSystemPrompt = `Derive the source entity's current outgoing relationship links from its current Lore.

Use only relationships explicitly established by the source Lore. Do not infer hidden identity, motive, affiliation, causality, or relationships from proximity. Do not promote rumors, attributed character claims, speculation, possibilities, or uncertainty into relationship links.

Relationship links are a current derived projection, not history. Omit transient relationships that the source Lore establishes have ended, been completed, or been superseded. Enduring relationships such as parentage may remain even when historical circumstances change.

Choose targets only from the supplied candidates. Each relationship must describe the direction from the source to the target as a concise natural-language predicate of at most ${MAX_RELATIONSHIP_WORDS} words and ${MAX_RELATIONSHIP_LENGTH} characters, for example "daughter of", "member of", or "located in". Use lowercase. Do not include evidence, chronology, qualifiers, or explanation in the relationship label. Omit a candidate when no useful current relationship is established.`
