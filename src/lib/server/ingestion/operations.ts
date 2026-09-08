import { randomUUID } from 'node:crypto'
import { all, fail as failEffect, gen, type Effect } from 'effect/Effect'
import { buildSessionRecap, canonicalDocumentContent } from '../../ingestion'
import type { AiProvider } from '../ai/provider'
import type { Failure } from '../failure'
import type { VaultDocument } from '../vault/types'
import { chunkTranscript } from './chunking'
import { locateEvidence } from './evidence'
import { matchDocument, resolveReference } from './matching'
import type { IngestionStorage } from './storage'
import type {
	Evidence,
	ExtractedSessionClaim,
	SessionIngestionDraft,
	SessionIngestionResult,
	SessionProposal,
	SessionProposalResolution
} from './types'

const categoryDirectory: Record<VaultDocument['type'], string> = {
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
		.replace(/^-|-$/g, '') || 'document'

const normalize = (value: string) => value.trim().toLocaleLowerCase()

const uniqueStrings = (values: string[]) => [
	...new Map(values.map((value) => [normalize(value), value])).values()
]

const uniqueEvidence = (evidence: Evidence[]) => [
	...new Map(
		evidence.map((item) => [`${item.startStringIndex}:${item.endStringIndex}`, item])
	).values()
]

const uniqueReferences = (references: SessionProposal['references']) => [
	...new Map(
		references.map((reference) => [
			reference.documentId ? `id:${reference.documentId}` : `label:${normalize(reference.label)}`,
			reference
		])
	).values()
]

const combineContent = (contents: string[]) =>
	uniqueStrings(contents.map((content) => content.trim()).filter(Boolean)).join('\n\n')

type ValidatedClaim = ExtractedSessionClaim & {
	claimId: string
	evidence: Evidence[]
}

const normalizedClaimKey = (claim: ExtractedSessionClaim) =>
	[claim.kind, claim.documentType, claim.title, claim.content]
		.map((value) => value.trim().toLocaleLowerCase())
		.join('\u0000')

const mergeClaims = (claims: ValidatedClaim[]) => {
	const merged = new Map<string, ValidatedClaim>()
	for (const claim of claims) {
		const key = normalizedClaimKey(claim)
		const existing = merged.get(key)
		if (existing) {
			existing.evidence = uniqueEvidence([...existing.evidence, ...claim.evidence])
			existing.references = uniqueStrings([...existing.references, ...claim.references])
			existing.after = uniqueStrings([...existing.after, ...claim.after])
			if (claim.certainty === 'inferred') existing.certainty = 'inferred'
		} else merged.set(key, { ...claim, evidence: [...claim.evidence] })
	}
	return [...merged.values()]
}

const operationFor = (
	claim: ValidatedClaim,
	match: ReturnType<typeof matchDocument>
): SessionProposal['operation'] => {
	if (claim.kind === 'mention') return 'mention-only'
	if (claim.kind === 'development' || claim.documentType === 'event') return 'create-event'
	return match.kind === 'exact' ? 'update-canon' : 'create-entity'
}

const proposalFor = (claim: ValidatedClaim, documents: VaultDocument[]): SessionProposal => {
	const match = matchDocument(claim.title, documents)
	const operation = operationFor(claim, match)
	const matchedDocument =
		match.kind === 'exact' ? documents.find(({ id }) => id === match.documentId) : undefined
	const hasPossibleMatches = match.kind === 'unresolved' && match.candidates.length > 0
	const selectable =
		claim.certainty === 'explicit' && operation !== 'mention-only' && !hasPossibleMatches

	return {
		proposalId: randomUUID(),
		claimIds: [claim.claimId],
		operation,
		documentType: operation === 'create-event' ? 'event' : claim.documentType,
		title: operation === 'update-canon' && match.kind === 'exact' ? match.title : claim.title,
		certainty: claim.certainty,
		selected: selectable && (operation !== 'update-canon' || Boolean(matchedDocument)),
		evidence: claim.evidence,
		match,
		references: claim.references.map((label) => resolveReference(label, documents)),
		after: claim.after.map((label) => resolveReference(label, documents)),
		content: claim.content,
		...(operation === 'update-canon' && matchedDocument?.currentRevisionId
			? {
					base: {
						documentId: matchedDocument.id,
						revisionId: matchedDocument.currentRevisionId
					},
					patch: { kind: 'append' as const, content: claim.content }
				}
			: {})
	}
}

const proposalGroupKey = (proposal: SessionProposal) =>
	proposal.operation === 'update-canon' && proposal.base
		? `update:${proposal.base.documentId}`
		: `${proposal.operation}:${proposal.documentType}:${normalize(proposal.title)}`

const mergeProposals = (proposals: SessionProposal[]) => {
	const grouped = new Map<string, SessionProposal>()
	for (const proposal of proposals) {
		const groupId = proposalGroupKey(proposal)
		const existing = grouped.get(groupId)
		if (!existing) {
			grouped.set(groupId, { ...proposal, groupId })
			continue
		}

		const content = combineContent([existing.content, proposal.content])
		const certainty =
			existing.certainty === 'explicit' && proposal.certainty === 'explicit'
				? 'explicit'
				: 'inferred'
		const hasPossibleMatches =
			existing.match.kind === 'unresolved' && existing.match.candidates.length > 0
		grouped.set(groupId, {
			...existing,
			claimIds: uniqueStrings([...existing.claimIds, ...proposal.claimIds]),
			certainty,
			selected:
				certainty === 'explicit' && existing.operation !== 'mention-only' && !hasPossibleMatches,
			evidence: uniqueEvidence([...existing.evidence, ...proposal.evidence]),
			references: uniqueReferences([...existing.references, ...proposal.references]),
			after: uniqueReferences([...existing.after, ...proposal.after]),
			content,
			...(existing.patch ? { patch: { ...existing.patch, content } } : {})
		})
	}
	return [...grouped.values()]
}

export const sessionIngestionOperations = ({
	ai,
	storage,
	vault
}: {
	ai: Pick<AiProvider, 'analyzeSessionChunk'> & {
		analysisModel: string
	}
	storage: IngestionStorage
	vault: {
		getDocuments: (campaignId: string) => Effect<VaultDocument[], Failure>
		createDocument: (
			campaignId: string,
			input: {
				documentId?: string
				path: string
				type: VaultDocument['type']
				after?: string[]
				content: string
				ingestionId?: string
				transcript?: string
				revision?: {
					source: 'ingestion'
					relatedSessionId: string
					ingestionId: string
					changeSummary: string
				}
			}
		) => Effect<VaultDocument, Failure>
		updateDocument: (
			campaignId: string,
			documentId: string,
			input: {
				type: VaultDocument['type']
				aliases?: string[]
				after?: string[]
				content: string
				expectedRevisionId: string
				revision?: {
					source: 'ingestion'
					relatedSessionId: string
					ingestionId: string
					changeSummary: string
				}
			}
		) => Effect<VaultDocument, Failure>
	}
}) => {
	const analyze = (input: { campaignId: string; title: string; transcript: string }) =>
		gen(function* () {
			const documents = yield* vault.getDocuments(input.campaignId)
			const chunks = chunkTranscript(input.transcript)
			const validClaims: ValidatedClaim[] = []
			const warnings: string[] = []

			for (const chunk of chunks) {
				const claims = yield* ai.analyzeSessionChunk({
					model: ai.analysisModel,
					system:
						'Extract atomic campaign claims. Every claim must quote exact evidence from the supplied transcript chunk, and its content must be directly supported by that excerpt. Mark interpretation as inferred and mere names as mentions. Do not invent, paraphrase, or combine evidence.',
					prompt: `## Transcript chunk ${chunk.chunkId}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${chunk.content}`
				})

				for (const [claimIndex, claim] of claims.entries()) {
					const evidence = locateEvidence(input.transcript, chunk, claim.excerpt)
					if (!evidence) {
						warnings.push(
							`${chunk.chunkId} claim ${claimIndex + 1} was discarded because its evidence was absent or ambiguous.`
						)
						continue
					}
					validClaims.push({
						...claim,
						claimId: randomUUID(),
						evidence: [evidence]
					})
				}
			}

			const claims = mergeClaims(validClaims)
			const claimProposals = mergeProposals(claims.map((claim) => proposalFor(claim, documents)))
			const ingestionId = randomUUID()
			const sessionProposal: SessionProposal = {
				proposalId: randomUUID(),
				claimIds: claims.map(({ claimId }) => claimId),
				operation: 'create-entity',
				documentType: 'session',
				title: input.title,
				certainty: 'explicit',
				selected: true,
				evidence: claims.flatMap(({ evidence }) => evidence),
				match: { kind: 'unresolved', candidates: [] },
				references: [],
				after: [],
				content: buildSessionRecap(
					input.title,
					claimProposals.filter(({ selected }) => selected)
				)
			}
			const draft: SessionIngestionDraft = {
				schemaVersion: 1,
				ingestionId,
				campaignId: input.campaignId,
				title: input.title,
				createdAt: new Date().toISOString(),
				warnings,
				proposals: [sessionProposal, ...claimProposals]
			}

			yield* storage.write(draft, input.transcript)
			return draft
		})

	const commit = (input: {
		campaignId: string
		ingestionId: string
		selectedProposalIds: string[]
		resolutions?: SessionProposalResolution[]
	}): Effect<SessionIngestionResult, Failure> =>
		gen(function* () {
			const [draft, transcript, documents] = yield* all([
				storage.read(input.campaignId, input.ingestionId),
				storage.readTranscript(input.campaignId, input.ingestionId),
				vault.getDocuments(input.campaignId)
			])
			const selectedIds = new Set(input.selectedProposalIds)
			const selected = draft.proposals.filter(({ proposalId }) => selectedIds.has(proposalId))
			if (
				input.selectedProposalIds.length !== selectedIds.size ||
				selected.length !== selectedIds.size
			) {
				return yield* failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'unknownProposal' }
				} satisfies Failure)
			}
			const sessionProposal = draft.proposals.find(({ documentType }) => documentType === 'session')
			if (!sessionProposal || !selectedIds.has(sessionProposal.proposalId)) {
				return yield* failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'sessionProposalRequired' }
				} satisfies Failure)
			}
			if (selected.some((proposal) => proposal.operation === 'mention-only')) {
				return yield* failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'unselectableProposal' }
				} satisfies Failure)
			}

			const resolutions = input.resolutions ?? []
			const resolutionByProposal = new Map(
				resolutions.map((resolution) => [resolution.proposalId, resolution])
			)
			if (
				resolutionByProposal.size !== resolutions.length ||
				resolutions.some(({ proposalId }) => !selectedIds.has(proposalId))
			) {
				return yield* failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'invalidResolution' }
				} satisfies Failure)
			}

			const resolvedSelected: SessionProposal[] = []
			for (const proposal of selected) {
				const resolution = resolutionByProposal.get(proposal.proposalId)
				if (proposal.match.kind !== 'unresolved' || proposal.match.candidates.length === 0) {
					if (resolution) {
						return yield* failEffect({
							domain: 'ingestion',
							operation: 'commit',
							cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
						} satisfies Failure)
					}
					resolvedSelected.push(proposal)
					continue
				}
				if (!resolution) {
					return yield* failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'unresolvedMatch', proposalId: proposal.proposalId }
					} satisfies Failure)
				}
				if (resolution.kind === 'create') {
					resolvedSelected.push(proposal)
					continue
				}

				const candidate = proposal.match.candidates.find(
					({ documentId }) => documentId === resolution.documentId
				)
				if (!candidate) {
					return yield* failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'invalidResolution', proposalId: proposal.proposalId }
					} satisfies Failure)
				}
				resolvedSelected.push({
					...proposal,
					operation: 'update-canon',
					documentType: candidate.documentType,
					match: {
						kind: 'exact',
						documentId: candidate.documentId,
						title: candidate.title,
						documentType: candidate.documentType
					},
					base: { documentId: candidate.documentId, revisionId: candidate.revisionId },
					patch: { kind: 'append', content: proposal.content }
				})
			}

			const documentIdByProposal = new Map(
				resolvedSelected.map((proposal) => [
					proposal.proposalId,
					proposal.operation === 'update-canon' && proposal.base
						? proposal.base.documentId
						: randomUUID()
				])
			)
			const selectedByTitle = new Map(
				resolvedSelected.map((proposal) => [
					normalize(proposal.title),
					documentIdByProposal.get(proposal.proposalId)!
				])
			)
			const existingById = new Map(documents.map((document) => [document.id, document]))
			const updatedDocumentIds = resolvedSelected
				.filter(({ operation }) => operation === 'update-canon')
				.map((proposal) => documentIdByProposal.get(proposal.proposalId)!)
			if (new Set(updatedDocumentIds).size !== updatedDocumentIds.length) {
				return yield* failEffect({
					domain: 'ingestion',
					operation: 'commit',
					cause: { reason: 'duplicateDocumentMutation' }
				} satisfies Failure)
			}
			const resolveAfter = (proposal: SessionProposal) => {
				const resolved: string[] = []
				for (const reference of proposal.after) {
					const documentId =
						(reference.documentId && existingById.has(reference.documentId)
							? reference.documentId
							: undefined) ?? selectedByTitle.get(normalize(reference.label))
					if (!documentId) return undefined
					resolved.push(documentId)
				}
				return [...new Set(resolved)]
			}
			type PlannedMutation = {
				proposal: SessionProposal
				documentId: string
				path?: string
				after?: string[]
			}
			const planned: PlannedMutation[] = []
			const createPaths = new Set<string>()
			for (const proposal of resolvedSelected) {
				const documentId = documentIdByProposal.get(proposal.proposalId)!
				if (proposal.operation === 'update-canon') {
					const existing = existingById.get(documentId)
					if (!existing || !proposal.base || !proposal.patch) {
						return yield* failEffect({
							domain: 'ingestion',
							operation: 'commit',
							cause: { reason: 'missingUpdateBase', proposalId: proposal.proposalId }
						} satisfies Failure)
					}
					planned.push({ proposal, documentId })
					continue
				}

				const after = resolveAfter(proposal)
				if (!after) {
					return yield* failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'unresolvedChronology', proposalId: proposal.proposalId }
					} satisfies Failure)
				}
				const path = `${categoryDirectory[proposal.documentType]}/${toSlug(proposal.title)}.md`
				if (createPaths.has(path) || documents.some((document) => document.path === path)) {
					return yield* failEffect({
						domain: 'ingestion',
						operation: 'commit',
						cause: { reason: 'duplicateDocumentPath', path }
					} satisfies Failure)
				}
				createPaths.add(path)
				planned.push({ proposal, documentId, path, after })
			}

			const committed: SessionIngestionResult['documents'] = []
			const sessionDocumentId = documentIdByProposal.get(sessionProposal.proposalId)!
			const approvedSessionContent = buildSessionRecap(
				draft.title,
				resolvedSelected.filter(({ documentType }) => documentType !== 'session')
			)
			for (const { proposal, documentId, path, after } of planned) {
				const revision = {
					source: 'ingestion' as const,
					relatedSessionId: sessionDocumentId,
					ingestionId: input.ingestionId,
					changeSummary:
						proposal.documentType === 'session'
							? `Created from session ingestion: ${draft.title}`
							: `Applied from session: ${draft.title}`
				}
				if (proposal.operation === 'update-canon') {
					const existing = existingById.get(documentId)!
					yield* vault.updateDocument(input.campaignId, documentId, {
						type: existing.type,
						aliases: existing.aliases,
						after: existing.after,
						content: `${existing.content.trimEnd()}\n\n${proposal.patch!.content.trim()}\n`,
						expectedRevisionId: proposal.base!.revisionId,
						revision
					})
				} else {
					yield* vault.createDocument(input.campaignId, {
						documentId,
						path: path!,
						type: proposal.documentType,
						content:
							proposal.documentType === 'session'
								? approvedSessionContent
								: canonicalDocumentContent(proposal.title, proposal.content),
						after,
						ingestionId: proposal.documentType === 'session' ? input.ingestionId : undefined,
						transcript: proposal.documentType === 'session' ? transcript : undefined,
						revision
					})
				}
				committed.push({
					proposalId: proposal.proposalId,
					documentId,
					documentType: proposal.documentType
				})
			}

			return {
				documents: committed,
				sessionDocumentId
			}
		})

	return { analyze, commit, getDraft: storage.read }
}
