import type { VaultDocument } from '../vault/types'
import type { ProposalCandidate, ProposalMatch, ProposalReference } from './types'

const normalize = (value: string) => value.trim().toLocaleLowerCase()
const tokens = (value: string) => new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])

const candidateScore = (query: string, document: VaultDocument) => {
	const queryTokens = tokens(query)
	if (!queryTokens.size) return 0
	const names = [document.title, ...(document.aliases ?? [])]
	return Math.max(
		...names.map((name) => {
			const nameTokens = tokens(name)
			const overlap = [...queryTokens].filter((token) => nameTokens.has(token)).length
			return overlap / Math.max(queryTokens.size, nameTokens.size)
		})
	)
}

export const matchDocument = (query: string, documents: VaultDocument[]): ProposalMatch => {
	const normalized = normalize(query)
	const exact = documents.filter((document) =>
		[document.title, ...(document.aliases ?? [])].some((name) => normalize(name) === normalized)
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

	const candidates: ProposalCandidate[] = documents
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

export const resolveReference = (label: string, documents: VaultDocument[]): ProposalReference => {
	const match = matchDocument(label, documents)
	return match.kind === 'exact' ? { label, documentId: match.documentId } : { label }
}
