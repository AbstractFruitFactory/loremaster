import { createHash, randomUUID } from 'node:crypto'

export const allocateIngestionId = () => randomUUID()

const deterministicUuid = (scope: string) => {
	const bytes = createHash('sha256').update(scope).digest().subarray(0, 16)
	bytes[6] = (bytes[6]! & 0x0f) | 0x50
	bytes[8] = (bytes[8]! & 0x3f) | 0x80
	const value = bytes.toString('hex')
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export const ingestionDocumentId = (ingestionId: string, proposalId: string) =>
	deterministicUuid(`loremaster:ingestion:${ingestionId}:document:${proposalId}`)

export const commitMutationId = (
	ingestionId: string,
	kind: 'create' | 'update' | 'chronology',
	documentId: string,
	proposalId?: string
) =>
	deterministicUuid(
		`loremaster:ingestion:${ingestionId}:mutation:${kind}:${documentId}:${proposalId ?? ''}`
	)

export const commitRevisionId = (mutationId: string) =>
	deterministicUuid(`loremaster:commit-mutation:${mutationId}:revision`)
