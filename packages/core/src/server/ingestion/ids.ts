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

export const campaignImportContentHash = (content: string) =>
	createHash('sha256').update(content).digest('hex')

export const campaignImportSourceId = (ingestionId: string, sourceSlot: number) =>
	deterministicUuid(`loremaster:campaign-import:source:${ingestionId}:${sourceSlot}`)

export const campaignImportSourceRevisionId = (sourceId: string, contentHash: string) =>
	deterministicUuid(`loremaster:campaign-import:source-revision:${sourceId}:${contentHash}`)

export const campaignImportProposalId = (
	ingestionId: string,
	documentType: string,
	groupingKey: string,
	claimIdentities: { claimFingerprint: string; claimId: string }[]
) =>
	deterministicUuid(
		`loremaster:campaign-import:proposal:${JSON.stringify({
			ingestionId,
			documentType,
			groupingKey,
			claimIdentities: claimIdentities
				.map(({ claimFingerprint, claimId }) => ({ claimFingerprint, claimId }))
				.sort(
					(left, right) =>
						left.claimFingerprint.localeCompare(right.claimFingerprint) ||
						left.claimId.localeCompare(right.claimId)
				)
		})}`
	)

export const campaignImportChronologyId = (
	ingestionId: string,
	relation: string,
	sourceDocumentId: string,
	targetDocumentId: string
) =>
	deterministicUuid(
		`loremaster:campaign-import:chronology:${ingestionId}:${relation}:${sourceDocumentId}:${targetDocumentId}`
	)

export const campaignImportClaimFingerprint = (input: {
	kind: string
	eventTitle: string | null
	content: string
	entityReferences: { label: string; type: string; role: string; eventForm?: string | null }[]
}) =>
	createHash('sha256')
		.update(
			JSON.stringify({
				version: 1,
				kind: input.kind,
				eventTitle: input.eventTitle?.trim().toLocaleLowerCase() ?? null,
				content: input.content.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
				entityReferences: input.entityReferences
					.map(({ label, type, role, eventForm }) => ({
						label: label.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
						type,
						role,
						eventForm
					}))
					.sort(
						(left, right) =>
							left.type.localeCompare(right.type) ||
							left.label.localeCompare(right.label) ||
							left.role.localeCompare(right.role)
					)
			})
		)
		.digest('hex')

export const campaignImportClaimId = (
	sourceId: string,
	sourceRevisionId: string,
	claimFingerprint: string,
	evidence: {
		startStringIndex: number
		endStringIndex: number
		startLine: number
		endLine: number
	}[]
) =>
	deterministicUuid(
		`loremaster:campaign-import:claim:${JSON.stringify({
			sourceId,
			sourceRevisionId,
			claimFingerprint,
			evidence: evidence.map(({ startStringIndex, endStringIndex, startLine, endLine }) => [
				startStringIndex,
				endStringIndex,
				startLine,
				endLine
			])
		})}`
	)
