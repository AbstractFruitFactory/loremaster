import type { VaultDocument } from '../vault/types'
import type {
	IngestionDocumentType,
	ProposalCandidate,
	ProposalMatch,
	ProposalReference
} from './types'

const normalize = (value: string) => value.trim().toLocaleLowerCase()
const tokens = (value: string) => new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])
const namesFor = (document: VaultDocument) => [document.title, ...(document.aliases ?? [])]

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

const strongPartialMatch = (query: string, document: VaultDocument) => {
	const queryTokens = tokens(query)
	if (!queryTokens.size) return false
	return namesFor(document).some((name) => {
		const nameTokens = tokens(name)
		return [...queryTokens].every((token) => nameTokens.has(token))
	})
}

export const matchDocument = (
	query: string,
	documents: VaultDocument[],
	expectedType?: IngestionDocumentType
): ProposalMatch => {
	const normalized = normalize(query)
	const eligible = documents.filter((document) => typeMatches(document, expectedType))
	const exact = eligible.filter((document) =>
		namesFor(document).some((name) => normalize(name) === normalized)
	)

	if (exact.length === 1) {
		const [document] = exact
		return {
			kind: 'exact',
			documentId: document.id,
			title: document.title,
			documentType: document.type
		}
	}

	const partial = eligible.filter((document) => strongPartialMatch(query, document))
	if (partial.length === 1) {
		const [document] = partial
		return {
			kind: 'exact',
			documentId: document.id,
			title: document.title,
			documentType: document.type
		}
	}

	const candidates: ProposalCandidate[] = eligible
		.filter((document): document is VaultDocument & { currentRevisionId: string } =>
			Boolean(document.currentRevisionId)
		)
		.map((document) => ({
			documentId: document.id,
			revisionId: document.currentRevisionId,
			title: document.title,
			documentType: document.type,
			score: candidateScore(query, document)
		}))
		.filter(({ score }) => score > 0)
		.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
		.slice(0, 5)

	return { kind: 'unresolved', candidates }
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
