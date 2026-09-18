import type { VaultDocument } from '../vault/types.js'
import type {
	IngestionDocumentType,
	ProposalCandidate,
	ProposalMatch,
	ProposalReference
} from './types.js'

export type CandidateProvenance = 'exact-name' | 'alias' | 'partial-name' | 'relational-context'

export type IdentityCandidate = {
	candidate: ProposalCandidate
	provenance: Exclude<CandidateProvenance, 'relational-context'>
}

const normalize = (value: string) => value.trim().toLocaleLowerCase()
const tokens = (value: string) => new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])
const namesFor = (document: VaultDocument) => [document.title, ...(document.aliases ?? [])]
const insignificantNameTokens = new Set(['a', 'an', 'of', 'the'])

const tokenOverlap = (left: Set<string>, right: Set<string>) =>
	[...left].filter((token) => right.has(token)).length

const candidateScore = (query: string, document: VaultDocument) => {
	const queryTokens = tokens(query)
	if (!queryTokens.size) return 0
	return Math.max(
		...namesFor(document).map((name) => {
			const nameTokens = tokens(name)
			const overlap = tokenOverlap(queryTokens, nameTokens)
			return overlap / Math.max(queryTokens.size, nameTokens.size)
		})
	)
}

const typeMatches = (document: VaultDocument, expectedType?: IngestionDocumentType) =>
	!expectedType || document.type === expectedType

const asCandidate = (document: VaultDocument, score: number): ProposalCandidate | undefined =>
	document.currentRevisionId
		? {
				documentId: document.id,
				revisionId: document.currentRevisionId,
				title: document.title,
				documentType: document.type,
				score
			}
		: undefined

const significantTokens = (value: string) =>
	new Set([...tokens(value)].filter((token) => !insignificantNameTokens.has(token)))

const partialNameScore = (query: string, name: string) => {
	const queryTokens = significantTokens(query)
	const nameTokens = significantTokens(name)
	if (!queryTokens.size || !nameTokens.size) return 0
	const overlap = tokenOverlap(queryTokens, nameTokens)
	const smallerSize = Math.min(queryTokens.size, nameTokens.size)
	if (overlap !== smallerSize) return 0
	return overlap / Math.max(queryTokens.size, nameTokens.size)
}

export const identityCandidates = (
	query: string,
	documents: VaultDocument[],
	expectedType?: IngestionDocumentType
): IdentityCandidate[] => {
	const normalized = normalize(query)
	return documents
		.filter((document) => typeMatches(document, expectedType))
		.filter((document): document is VaultDocument & { currentRevisionId: string } =>
			Boolean(document.currentRevisionId)
		)
		.flatMap((document): IdentityCandidate[] => {
			const titleExact = normalize(document.title) === normalized
			const aliasExact = (document.aliases ?? []).some((alias) => normalize(alias) === normalized)
			const partialScore = Math.max(
				...namesFor(document).map((name) => partialNameScore(query, name))
			)
			const provenance = titleExact ? 'exact-name' : aliasExact ? 'alias' : 'partial-name'
			const score = titleExact ? 3 : aliasExact ? 2.75 : partialScore
			const candidate = score > 0 ? asCandidate(document, score) : undefined
			return candidate ? [{ candidate, provenance }] : []
		})
		.sort(
			(left, right) =>
				right.candidate.score - left.candidate.score ||
				left.candidate.title.localeCompare(right.candidate.title)
		)
		.slice(0, 5)
}

export const matchDocument = (
	query: string,
	documents: VaultDocument[],
	expectedType?: IngestionDocumentType
): ProposalMatch => {
	const identities = identityCandidates(query, documents, expectedType)
	if (
		identities.length === 1 &&
		(identities[0]!.provenance === 'exact-name' || identities[0]!.provenance === 'alias')
	) {
		const { candidate } = identities[0]!
		return {
			kind: 'exact',
			documentId: candidate.documentId,
			title: candidate.title,
			documentType: candidate.documentType
		}
	}

	return {
		kind: 'unresolved',
		candidates: identities.map(({ candidate }) => candidate)
	}
}

type WeightedCandidate = { document: VaultDocument; score: number }

const addWeightedCandidate = (
	weighted: Map<string, WeightedCandidate>,
	document: VaultDocument | undefined,
	score: number,
	expectedType: IngestionDocumentType
) => {
	if (!document || !typeMatches(document, expectedType) || !document.currentRevisionId) return
	const existing = weighted.get(document.id)
	if (!existing || score > existing.score) weighted.set(document.id, { document, score })
}

const addDirectCandidates = (
	weighted: Map<string, WeightedCandidate>,
	query: string,
	documents: VaultDocument[],
	expectedType: IngestionDocumentType
) => {
	const direct = matchDocument(query, documents, expectedType)
	if (direct.kind !== 'unresolved') return
	for (const candidate of direct.candidates) {
		addWeightedCandidate(
			weighted,
			documents.find(({ id }) => id === candidate.documentId),
			3 + candidate.score,
			expectedType
		)
	}
}

const findContextAnchors = (query: string, context: string, documents: VaultDocument[]) => {
	const contextTokens = tokens(`${query}\n${context}`)
	return documents
		.map((document) => ({
			document,
			score: Math.max(
				...namesFor(document).map((name) => tokenOverlap(contextTokens, tokens(name)))
			)
		}))
		.filter(({ score }) => score > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, 4)
}

const addAnchorNeighborhood = (
	weighted: Map<string, WeightedCandidate>,
	anchor: VaultDocument,
	score: number,
	documents: VaultDocument[],
	expectedType: IngestionDocumentType
) => {
	addWeightedCandidate(weighted, anchor, 1 + score, expectedType)
	for (const link of anchor.links) {
		const match = matchDocument(link, documents)
		if (match.kind === 'exact') {
			addWeightedCandidate(
				weighted,
				documents.find(({ id }) => id === match.documentId),
				2 + score,
				expectedType
			)
		}
	}

	const anchorNames = namesFor(anchor).map(normalize)
	for (const document of documents) {
		const linksBack = document.links.some((link) => anchorNames.includes(normalize(link)))
		const mentionsAnchor = anchorNames.some(
			(name) => name.length > 2 && normalize(document.content).includes(name)
		)
		if (linksBack || mentionsAnchor) {
			addWeightedCandidate(weighted, document, 1.5 + score, expectedType)
		}
	}
}

const rankedContextualCandidates = (
	weighted: Map<string, WeightedCandidate>,
	query: string,
	context: string
): ProposalCandidate[] =>
	[...weighted.values()]
		.map(({ document, score }) =>
			asCandidate(
				document,
				score + candidateScore(query, document) + candidateScore(context, document) * 0.25
			)
		)
		.filter((candidate): candidate is ProposalCandidate => Boolean(candidate))
		.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
		.slice(0, 8)

export const contextualCandidates = (
	query: string,
	context: string,
	documents: VaultDocument[],
	expectedType: IngestionDocumentType
): ProposalCandidate[] => {
	const weighted = new Map<string, WeightedCandidate>()
	addDirectCandidates(weighted, query, documents, expectedType)
	for (const { document, score } of findContextAnchors(query, context, documents)) {
		addAnchorNeighborhood(weighted, document, score, documents, expectedType)
	}
	return rankedContextualCandidates(weighted, query, context)
}

export const resolveReference = (label: string, documents: VaultDocument[]): ProposalReference => {
	const match = matchDocument(label, documents)
	return match.kind === 'exact' ? { label, documentId: match.documentId } : { label }
}
