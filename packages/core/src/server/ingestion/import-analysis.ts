import { fail as failEffect, gen, type Effect } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { Failure } from '../failure.js'
import type { VaultDocument } from '../vault/types.js'
import { claimValidation } from './claim-validation.js'
import { chunkTranscript } from './chunking.js'
import { mergeClaims } from './claims.js'
import {
	allocateIngestionId,
	campaignImportClaimFingerprint,
	campaignImportClaimId,
	campaignImportContentHash,
	campaignImportProposalId,
	campaignImportSourceId,
	campaignImportSourceRevisionId
} from './ids.js'
import {
	entityReferencesLabel,
	evidenceRangesLabel,
	importEvidenceRepairPrompt,
	importEvidenceRepairSystem,
	importExtractionSystem,
	importValidationPrompt,
	importValidationSystem,
	sourceChunkPrompt
} from './import-prompts.js'
import type { CampaignImportHistoryRepository } from './import-history.js'
import { campaignImportCommit, type ImportVault } from './import-commit.js'
import { campaignImportChronology } from './import-chronology.js'
import { resolveCampaignImportClaims } from './import-identity.js'
import { reconcileCampaignImportClaims } from './import-reconciliation.js'
import { campaignImportReview } from './import-review.js'
import type { ValidatedClaim } from './internal.js'
import { mergeProposals, proposalsForClaim } from './proposals.js'
import type {
	CampaignImportAnalysisStorage,
	CampaignImportReviewStorage,
	CampaignImportStorage
} from './storage.js'
import type {
	CampaignImportAnalyzeInput,
	CampaignImportDraft,
	CampaignImportRequestData,
	CampaignImportSource,
	CampaignImportSourceAnalysis,
	CampaignImportSourceData
} from './types.js'

export type CampaignImportAnalysisDependencies = {
	ai: Pick<
		AiProvider,
		'analyzeSessionChunk' | 'validateSessionClaims' | 'repairSessionClaimEvidence'
	> & {
		analysisModel: string
	}
	history: CampaignImportHistoryRepository
	storage: CampaignImportAnalysisStorage &
		Pick<
			CampaignImportReviewStorage,
			| 'initializeCampaignImportReviewState'
			| 'readCampaignImportReviewState'
			| 'updateCampaignImportReviewState'
		>
	retrieveAnalysisDocuments: (
		campaignId: string,
		claims: ValidatedClaim[]
	) => Effect<VaultDocument[], Failure>
}

export type CampaignImportDependencies = Omit<
	CampaignImportAnalysisDependencies,
	'ai' | 'storage'
> & {
	ai: CampaignImportAnalysisDependencies['ai'] & Pick<AiProvider, 'inferCampaignImportChronology'>
	storage: CampaignImportStorage
	vault: ImportVault
}

const sourceData = (
	ingestionId: string,
	sourceSlot: number,
	input: CampaignImportAnalyzeInput['sources'][number]
): CampaignImportSourceData => {
	const contentHash = campaignImportContentHash(input.content)
	const sourceId = campaignImportSourceId(ingestionId, sourceSlot)
	return {
		displayName: input.displayName,
		title: input.title,
		mediaType: input.mediaType,
		content: input.content,
		sourceId,
		sourceRevisionId: campaignImportSourceRevisionId(sourceId, contentHash),
		contentHash,
		byteLength: Buffer.byteLength(input.content)
	}
}

const sourceDescriptor = ({
	content: _content,
	...source
}: CampaignImportSourceData): CampaignImportSource => source

export const campaignImportAnalysis = ({
	ai,
	history,
	storage,
	retrieveAnalysisDocuments
}: CampaignImportAnalysisDependencies) => {
	const reviewOperations = campaignImportReview({ storage })
	const analyzeSourceContent = (source: CampaignImportSourceData) => {
		const { validateExtractedClaims } = claimValidation({
			ai,
			validationSystem: importValidationSystem,
			evidenceRepairSystem: importEvidenceRepairSystem,
			validationPrompt: (chunk, claims) => importValidationPrompt(source, chunk, claims),
			evidenceRepairPrompt: (chunk, claims) => importEvidenceRepairPrompt(source, chunk, claims),
			evidenceRangesLabel,
			entityReferencesLabel,
			logScope: 'campaign-import',
			evidenceMetadata: {
				sourceId: source.sourceId,
				sourceRevisionId: source.sourceRevisionId
			},
			claimId: (claim, evidence) => {
				const fingerprint = campaignImportClaimFingerprint(claim)
				return campaignImportClaimId(
					source.sourceId,
					source.sourceRevisionId,
					fingerprint,
					evidence
				)
			}
		})

		return gen(function* () {
			const claims: ValidatedClaim[] = []
			const warnings: string[] = []
			for (const originalChunk of chunkTranscript(source.content)) {
				const chunk = {
					...originalChunk,
					chunkId: `${source.sourceRevisionId}:${originalChunk.chunkId}`
				}
				const extracted = yield* ai.analyzeSessionChunk({
					model: ai.analysisModel,
					system: importExtractionSystem,
					prompt: sourceChunkPrompt(source, chunk)
				})
				const validated = yield* validateExtractedClaims(source.content, chunk, extracted)
				claims.push(...validated.claims)
				warnings.push(...validated.warnings)
			}
			return { claims: mergeClaims(claims), warnings }
		})
	}

	const writeRequest = (
		request: CampaignImportRequestData,
		sources: CampaignImportSourceData[]
	): Effect<CampaignImportRequestData, Failure> => storage.writeCampaignImportData(request, sources)

	const persistDraft = (draft: CampaignImportDraft): Effect<void, Failure> =>
		gen(function* () {
			yield* storage.writeCampaignImportDraft(draft)
			yield* reviewOperations.initialize(draft)
		})

	const persistRequest = (input: CampaignImportAnalyzeInput) =>
		gen(function* () {
			const ingestionId = input.ingestionId ?? allocateIngestionId()
			const sources = input.sources.map((source, sourceSlot) =>
				sourceData(ingestionId, sourceSlot, source)
			)
			const request: CampaignImportRequestData = {
				schemaVersion: 1,
				kind: 'campaign-import',
				ingestionId,
				campaignId: input.campaignId,
				createdAt: new Date().toISOString(),
				sources: sources.map(sourceDescriptor)
			}
			return yield* writeRequest(request, sources)
		})

	const getRequest = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportRequestData, Failure> =>
		storage.readCampaignImportData(campaignId, ingestionId)

	const getSource = (
		request: CampaignImportRequestData,
		sourceRevisionId: string
	): Effect<CampaignImportSourceData, Failure> =>
		gen(function* () {
			const descriptor = request.sources.find(
				(source) => source.sourceRevisionId === sourceRevisionId
			)
			if (!descriptor) {
				return yield* failEffect({
					domain: 'ingestionStorage',
					operation: 'readCampaignImportSource',
					cause: { reason: 'unknownSource', sourceRevisionId }
				})
			}
			const content = yield* storage.readCampaignImportSource(
				request.campaignId,
				descriptor.sourceId,
				sourceRevisionId
			)
			return { ...descriptor, content }
		})

	const analyzePersistedSource = (
		campaignId: string,
		ingestionId: string,
		sourceRevisionId: string
	): Effect<CampaignImportSourceAnalysis, Failure> =>
		gen(function* () {
			const request = yield* getRequest(campaignId, ingestionId)
			const source = yield* getSource(request, sourceRevisionId)
			const result = yield* analyzeSourceContent(source)
			const claims = reconcileCampaignImportClaims(result.claims).claims
			return {
				sourceId: source.sourceId,
				sourceRevisionId,
				claims,
				warnings: result.warnings
			}
		})

	const buildDraft = (
		request: CampaignImportRequestData,
		analyses: CampaignImportSourceAnalysis[]
	) =>
		gen(function* () {
			const reconciliation = reconcileCampaignImportClaims(analyses.flatMap(({ claims }) => claims))
			const acceptedFingerprints = yield* history.getAcceptedClaimFingerprints(
				request.campaignId,
				reconciliation.claims.map(({ claimFingerprint }) => claimFingerprint)
			)
			const claims = reconciliation.claims.filter(
				({ claimFingerprint }) => !acceptedFingerprints.has(claimFingerprint)
			)
			const documents = yield* retrieveAnalysisDocuments(request.campaignId, claims)
			const resolvedClaims = resolveCampaignImportClaims(claims, documents)
			const claimById = new Map(claims.map((claim) => [claim.claimId, claim]))
			const proposals = mergeProposals(resolvedClaims.flatMap(proposalsForClaim))
				.map((proposal) => {
					const groupingKey =
						proposal.groupId ??
						JSON.stringify([proposal.operation, proposal.documentType, proposal.title])
					const claimIdentities = proposal.claimIds.map((claimId) => ({
						claimId,
						claimFingerprint: claimById.get(claimId)?.claimFingerprint ?? claimId
					}))
					claimIdentities.sort(
						(left, right) =>
							left.claimFingerprint.localeCompare(right.claimFingerprint) ||
							left.claimId.localeCompare(right.claimId)
					)
					return { proposal, groupingKey, claimIdentities }
				})
				.sort(
					(left, right) =>
						left.proposal.documentType.localeCompare(right.proposal.documentType) ||
						left.groupingKey.localeCompare(right.groupingKey) ||
						JSON.stringify(left.claimIdentities).localeCompare(
							JSON.stringify(right.claimIdentities)
						)
				)
				.map(({ proposal, groupingKey, claimIdentities }) => ({
					...proposal,
					proposalId: campaignImportProposalId(
						request.ingestionId,
						proposal.documentType,
						groupingKey,
						claimIdentities
					)
				}))
			const draft: CampaignImportDraft = {
				schemaVersion: 1,
				kind: 'campaign-import',
				ingestionId: request.ingestionId,
				campaignId: request.campaignId,
				createdAt: request.createdAt,
				sources: request.sources,
				claims,
				temporalClaims: claims.filter((claim) => claim.kind === 'development'),
				proposals,
				warnings: analyses.flatMap(({ warnings }) => warnings)
			}
			return draft
		})

	const analyzePersisted = (campaignId: string, ingestionId: string) =>
		gen(function* () {
			const request = yield* getRequest(campaignId, ingestionId)
			const analyses: CampaignImportSourceAnalysis[] = []
			for (const source of request.sources) {
				analyses.push(
					yield* analyzePersistedSource(campaignId, ingestionId, source.sourceRevisionId)
				)
			}
			const draft = yield* buildDraft(request, analyses)
			yield* persistDraft(draft)
			return draft
		})

	const analyze = (input: CampaignImportAnalyzeInput) =>
		gen(function* () {
			const request = yield* persistRequest(input)
			return yield* analyzePersisted(request.campaignId, request.ingestionId)
		})

	const getDraft = (
		campaignId: string,
		ingestionId: string
	): Effect<CampaignImportDraft, Failure> =>
		storage.readCampaignImportDraft(campaignId, ingestionId)

	const saveReviewState = (input: import('./types.js').CampaignImportReviewUpdateInput) =>
		gen(function* () {
			const draft = yield* getDraft(input.campaignId, input.ingestionId)
			return yield* reviewOperations.saveState(draft, input)
		})

	return {
		allocateIngestionId,
		analyze,
		analyzePersisted,
		analyzePersistedSource,
		buildDraft,
		getDraft,
		getRequest,
		getReviewState: reviewOperations.getState,
		persistDraft,
		persistRequest,
		reconcileClaims: reconcileCampaignImportClaims,
		review: {
			getState: reviewOperations.getState,
			saveState: saveReviewState
		},
		saveReviewState
	}
}

export const campaignImport = (dependencies: CampaignImportDependencies) => {
	const analysisOperations = campaignImportAnalysis(dependencies)
	const commitOperations = campaignImportCommit(dependencies)
	const chronologyOperations = campaignImportChronology(dependencies)
	return {
		...analysisOperations,
		commit: commitOperations.commit,
		commitOperations,
		chronology: chronologyOperations
	}
}
