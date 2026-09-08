import { randomUUID } from 'node:crypto'
import { gen, type Effect } from 'effect/Effect'
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
	SessionProposal
} from './types'

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
			for (const evidence of claim.evidence) {
				if (
					!existing.evidence.some(
						(current) =>
							current.startStringIndex === evidence.startStringIndex &&
							current.endStringIndex === evidence.endStringIndex
					)
				) {
					existing.evidence.push(evidence)
				}
			}
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
	const selectable = claim.certainty === 'explicit' && operation !== 'mention-only'

	return {
		proposalId: randomUUID(),
		claimIds: [claim.claimId],
		operation,
		documentType: operation === 'create-event' ? 'event' : claim.documentType,
		title: claim.title,
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

export const sessionIngestionOperations = ({
	ai,
	storage,
	vault
}: {
	ai: Pick<AiProvider, 'analyzeSessionChunk' | 'generateText'> & {
		analysisModel: string
		summaryModel: string
	}
	storage: IngestionStorage
	vault: {
		getDocuments: (campaignId: string) => Effect<VaultDocument[], Failure>
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
						'Extract atomic campaign claims. Every claim must quote exact evidence from the supplied transcript chunk. Do not invent, paraphrase, or combine evidence.',
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
			const recap = yield* ai.generateText({
				model: ai.summaryModel,
				system:
					'Write a concise factual tabletop session recap using only the validated claims supplied. Do not add details.',
				prompt: claims.length
					? claims.map((claim) => `- ${claim.content}`).join('\n')
					: 'No validated claims were extracted.'
			})
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
				content: `# ${input.title}\n\n${recap.trim()}`
			}
			const draft: SessionIngestionDraft = {
				schemaVersion: 1,
				ingestionId,
				campaignId: input.campaignId,
				title: input.title,
				createdAt: new Date().toISOString(),
				warnings,
				proposals: [sessionProposal, ...claims.map((claim) => proposalFor(claim, documents))]
			}

			yield* storage.write(draft, input.transcript)
			return draft
		})

	return { analyze, getDraft: storage.read }
}
