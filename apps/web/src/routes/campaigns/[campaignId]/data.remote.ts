import { command, query } from '$app/server'
import { error } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import { documentTypes } from '#lib/document.js'
import { campaign, ingestion, lore, vault } from '#lib/server/app.js'
import { getIngestionDbosAdapter } from '#lib/server/dbos/client.js'
import { mapIngestionWorkflowStatus } from '#lib/server/dbos/status.js'
import { logFailure } from '#lib/server/failure.js'
import {
	commitCampaignImportChronologyOperation,
	commitCampaignImportOperation,
	discardCampaignImportOperation,
	finishCampaignImportOperation,
	getCampaignImportChronologyOperation,
	getCampaignImportLifecycleOperation,
	getCampaignImportOperation,
	getCampaignImportReviewStateOperation,
	getCampaignImportWorkflowStatusOperation,
	listCampaignImportsOperation,
	retryCampaignImportWorkflowOperation,
	saveCampaignImportReviewStateOperation,
	startCampaignImportChronologyOperation,
	startCampaignImportOperation
} from '#lib/server/campaign-import/orchestration.js'
import { ingestionDocumentId } from '@loremaster/core/server/ingestion/ids'
import {
	isCommitStartedIngestionDiscard,
	isImmutableIngestionConflict
} from '@loremaster/core/server/ingestion/storage'
import type {
	CampaignImportChronologyDraft,
	CampaignImportDraft,
	CampaignImportReviewState,
	SessionIngestionDraft,
	SessionIngestionResult,
	SessionIngestionSummary
} from '#lib/server/ingestion/types.js'
import {
	analysisWorkflowId,
	commitWorkflowId,
	type AnalysisStartReference,
	type AnalysisWorkflowStatus,
	type CommitStartReference,
	type CommitWorkflowStatus,
	type CampaignImportAnalysisWorkflowStatus,
	type CampaignImportChronologyAnalysisWorkflowStatus,
	type CampaignImportChronologyCommitWorkflowStatus,
	type CampaignImportCommitWorkflowStatus,
	type WorkflowReference
} from '@loremaster/core/workflows/contracts'
import type { LoreEntry, LoreSummary } from '#lib/server/lore/types.js'
import type {
	RevisionDiff,
	VaultRevision,
	VaultRevisionMetadata
} from '#lib/server/vault/revisions/types.js'
import type {
	VaultDocument,
	VaultDocumentSummary,
	VaultDocumentView
} from '#lib/server/vault/types.js'
import {
	campaignImportReferenceInput,
	commitCampaignImportChronologyInput,
	commitCampaignImportInput,
	saveCampaignImportReviewStateInput,
	startCampaignImportInput
} from './campaign-import-schema.js'

const campaignId = z.uuid()
const documentId = z.string().trim().min(1).max(200)
const revisionId = z.uuid()
const ingestionId = z.uuid()
const aliases = z.array(z.string().trim().min(1).max(200)).max(50).optional()
const eventPredecessors = z.array(documentId).max(100).optional()
const documentType = z.enum(documentTypes)
const documentReference = z
	.object({
		campaignId,
		documentId
	})
	.strict()
const documentsByTypeInput = z
	.object({
		campaignId,
		type: documentType
	})
	.strict()
const createDocumentInput = z
	.object({
		campaignId,
		path: z.string().trim().min(4).max(500),
		type: documentType,
		aliases,
		after: eventPredecessors,
		content: z.string().max(1_000_000)
	})
	.strict()
const updateDocumentInput = z
	.object({
		campaignId,
		documentId,
		type: documentType,
		aliases,
		after: eventPredecessors,
		content: z.string().max(1_000_000),
		currentRevisionId: revisionId
	})
	.strict()
const editDocumentInput = z
	.object({
		campaignId,
		documentId,
		title: z
			.string()
			.trim()
			.min(1)
			.max(200)
			.refine((value) => !/[\r\n]/.test(value)),
		content: z.string().max(1_000_000),
		currentRevisionId: revisionId
	})
	.strict()
const deleteDocumentInput = documentReference
	.extend({
		currentRevisionId: revisionId
	})
	.strict()
const revisionReference = documentReference
	.extend({
		revisionId
	})
	.strict()
const revisionDiffInput = documentReference
	.extend({
		toRevisionId: revisionId,
		fromRevisionId: revisionId.optional()
	})
	.strict()
const restoreRevisionInput = revisionReference
	.extend({
		currentRevisionId: revisionId,
		currentDocumentType: documentType
	})
	.strict()
const loreReference = z
	.object({
		campaignId,
		loreId: documentId
	})
	.strict()
const createLoreInput = z
	.object({
		campaignId,
		title: z.string().trim().min(1).max(200),
		category: documentType,
		content: z.string().trim().min(1).max(1_000_000)
	})
	.strict()
const analyzeSessionInput = z
	.object({
		campaignId,
		ingestionId: ingestionId.optional(),
		title: z.string().trim().min(1).max(200),
		transcript: z
			.string()
			.min(1)
			.max(2_000_000)
			.refine((value) => value.trim().length > 0)
	})
	.strict()
const ingestionReference = z.object({ campaignId, ingestionId }).strict()
const proposalResolution = z.discriminatedUnion('kind', [
	z.object({ proposalId: z.uuid(), kind: z.literal('create') }).strict(),
	z.object({ proposalId: z.uuid(), kind: z.literal('existing'), documentId }).strict()
])
const commitIngestionInput = ingestionReference
	.extend({
		selectedProposalIds: z.array(z.uuid()).min(1).max(500),
		selectedChronologyIds: z.array(z.uuid()).max(500),
		resolutions: z.array(proposalResolution).max(500)
	})
	.strict()
export const listLore = query(campaignId, (id): Promise<LoreSummary[]> =>
	runPromise(
		pipe(
			lore.listLore(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to load campaign lore')
				},
				onSuccess: (entries) => entries
			})
		)
	)
)

export const getLore = query(loreReference, ({ campaignId, loreId }): Promise<LoreEntry> =>
	runPromise(
		pipe(
			lore.getLore(campaignId, loreId),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Lore "${loreId}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to load lore')
				},
				onSuccess: (entry) => entry
			})
		)
	)
)

export const createLore = command(createLoreInput, (input): Promise<LoreEntry> =>
	runPromise(
		pipe(
			lore.createLore(input.campaignId, input),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'createDocument') {
						error(409, `Lore named "${input.title}" already exists in this category`)
					}

					logFailure(failure)
					error(500, 'Unable to add lore')
				},
				onSuccess: (entry) => {
					void listLore(input.campaignId).refresh()
					getLore({ campaignId: input.campaignId, loreId: entry.id }).set(entry)
					return entry
				}
			})
		)
	)
)

export const analyzeSession = command(
	analyzeSessionInput,
	async (input): Promise<AnalysisStartReference> => {
		const allocatedIngestionId = input.ingestionId ?? ingestion.allocateIngestionId()
		await runPromise(
			pipe(
				campaign.getCampaign(input.campaignId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${input.campaignId}" was not found`)
						}
						logFailure(failure)
						error(500, 'Unable to start this session analysis')
					},
					onSuccess: () => undefined
				})
			)
		)
		await runPromise(
			pipe(
				ingestion.persistTranscriptData({
					schemaVersion: 1,
					campaignId: input.campaignId,
					ingestionId: allocatedIngestionId,
					title: input.title,
					transcript: input.transcript
				}),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						if (isImmutableIngestionConflict(failure.cause)) {
							error(409, 'This ingestion ID is already used by a different request')
						}
						error(500, 'Unable to start this session analysis')
					},
					onSuccess: () => undefined
				})
			)
		)
		const workflowId = analysisWorkflowId(input.campaignId, allocatedIngestionId)
		try {
			const dbos = await getIngestionDbosAdapter()
			await dbos.enqueueAnalysis(workflowId, {
				campaignId: input.campaignId,
				ingestionId: allocatedIngestionId
			})
		} catch (cause) {
			console.error('[session-analysis.enqueue]', cause)
			error(503, 'Session analysis is temporarily unavailable')
		}
		return {
			campaignId: input.campaignId,
			ingestionId: allocatedIngestionId,
			workflowId
		}
	}
)

export const retrySessionAnalysis = command(
	ingestionReference,
	async ({ campaignId, ingestionId }): Promise<AnalysisStartReference> => {
		await runPromise(
			pipe(
				ingestion.getTranscriptData(campaignId, ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						error(404, 'Session analysis was not found')
					},
					onSuccess: () => undefined
				})
			)
		)
		const workflowId = analysisWorkflowId(campaignId, ingestionId)
		try {
			const dbos = await getIngestionDbosAdapter()
			await dbos.enqueueAnalysis(workflowId, { campaignId, ingestionId })
		} catch (cause) {
			console.error('[session-analysis.retry]', cause)
			error(503, 'Session analysis is temporarily unavailable')
		}
		return { campaignId, ingestionId, workflowId }
	}
)

export const getSessionAnalysisStatus = query(
	ingestionReference,
	async ({ campaignId, ingestionId }): Promise<AnalysisWorkflowStatus> => {
		await runPromise(
			pipe(
				ingestion.getTranscriptData(campaignId, ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						error(404, 'Session analysis was not found')
					},
					onSuccess: () => undefined
				})
			)
		)
		const workflowId = analysisWorkflowId(campaignId, ingestionId)
		try {
			const dbos = await getIngestionDbosAdapter()
			const state = await dbos.getWorkflowState(workflowId)
			return mapIngestionWorkflowStatus<SessionIngestionDraft>({
				kind: 'analysis',
				reference: { campaignId, ingestionId, workflowId },
				...state
			})
		} catch (cause) {
			console.error('[session-analysis.status]', cause)
			error(503, 'Session analysis status is temporarily unavailable')
		}
	}
)

export const getSessionIngestion = query(
	ingestionReference,
	({ campaignId, ingestionId }): Promise<SessionIngestionDraft> =>
		runPromise(
			pipe(
				ingestion.getDraft(campaignId, ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						error(404, 'Session analysis was not found')
					},
					onSuccess: (draft) => draft
				})
			)
		)
)

export const commitSessionIngestion = command(
	commitIngestionInput,
	async (input): Promise<CommitStartReference> => {
		const draft = await runPromise(
			pipe(
				ingestion.getDraft(input.campaignId, input.ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						error(404, 'Session analysis was not found')
					},
					onSuccess: (result) => result
				})
			)
		)
		const sessionProposal = draft.proposals.find((proposal) => proposal.documentType === 'session')
		if (!sessionProposal) error(409, 'This proposal selection cannot be committed.')
		await runPromise(
			pipe(
				ingestion.persistCommitData({
					schemaVersion: 1,
					...input
				}),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						if (isImmutableIngestionConflict(failure.cause)) {
							error(409, 'A different proposal selection is already being committed.')
						}
						error(500, 'Unable to persist this proposal selection')
					},
					onSuccess: () => undefined
				})
			)
		)
		const workflowId = commitWorkflowId(input.campaignId, input.ingestionId)
		try {
			const dbos = await getIngestionDbosAdapter()
			await dbos.enqueueCommit(workflowId, {
				campaignId: input.campaignId,
				ingestionId: input.ingestionId
			})
		} catch (cause) {
			console.error('[session-commit.enqueue]', cause)
			error(503, 'Session commit is temporarily unavailable')
		}
		void listUncommittedSessionIngestions(input.campaignId).refresh()
		return {
			campaignId: input.campaignId,
			ingestionId: input.ingestionId,
			workflowId,
			sessionDocumentId: ingestionDocumentId(input.ingestionId, sessionProposal.proposalId)
		}
	}
)

export const retrySessionCommit = command(
	ingestionReference,
	async ({ campaignId, ingestionId }): Promise<CommitStartReference> => {
		await runPromise(
			pipe(
				ingestion.getCommitData(campaignId, ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						error(404, 'Session commit was not found')
					},
					onSuccess: () => undefined
				})
			)
		)
		const draft = await runPromise(
			pipe(
				ingestion.getDraft(campaignId, ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						error(404, 'Session analysis was not found')
					},
					onSuccess: (result) => result
				})
			)
		)
		const sessionProposal = draft.proposals.find((proposal) => proposal.documentType === 'session')
		if (!sessionProposal) error(409, 'This proposal selection cannot be committed.')
		const workflowId = commitWorkflowId(campaignId, ingestionId)
		try {
			const dbos = await getIngestionDbosAdapter()
			await dbos.enqueueCommit(workflowId, { campaignId, ingestionId })
		} catch (cause) {
			console.error('[session-commit.retry]', cause)
			error(503, 'Session commit is temporarily unavailable')
		}
		return {
			campaignId,
			ingestionId,
			workflowId,
			sessionDocumentId: ingestionDocumentId(ingestionId, sessionProposal.proposalId)
		}
	}
)

export const getSessionCommitStatus = query(
	ingestionReference,
	async ({ campaignId, ingestionId }): Promise<CommitWorkflowStatus> => {
		await runPromise(
			pipe(
				ingestion.getCommitData(campaignId, ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						error(404, 'Session commit was not found')
					},
					onSuccess: () => undefined
				})
			)
		)
		const workflowId = commitWorkflowId(campaignId, ingestionId)
		try {
			const dbos = await getIngestionDbosAdapter()
			const state = await dbos.getWorkflowState(workflowId)
			return mapIngestionWorkflowStatus<SessionIngestionResult>({
				kind: 'commit',
				reference: { campaignId, ingestionId, workflowId },
				...state
			})
		} catch (cause) {
			console.error('[session-commit.status]', cause)
			error(503, 'Session commit status is temporarily unavailable')
		}
	}
)

const loadUncommittedSessionIngestions = (id: string): Promise<SessionIngestionSummary[]> =>
	runPromise(
		pipe(
			ingestion.listUncommitted(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}
					logFailure(failure)
					error(500, 'Unable to list uncommitted sessions')
				},
				onSuccess: (summaries) => summaries
			})
		)
	)

export const listUncommittedSessionIngestions = query(campaignId, loadUncommittedSessionIngestions)

export const discardSessionIngestion = command(
	ingestionReference,
	async ({ campaignId, ingestionId }) => {
		const summary = (await loadUncommittedSessionIngestions(campaignId)).find(
			(candidate) => candidate.ingestionId === ingestionId
		)
		if (!summary) error(404, 'Uncommitted session was not found')
		if (!summary.canDiscard) error(409, 'A session cannot be discarded after saving has started')

		try {
			const dbos = await getIngestionDbosAdapter()
			await dbos.cancelAnalysis(analysisWorkflowId(campaignId, ingestionId))
		} catch (cause) {
			console.error('[session-analysis.discard-cancel]', cause)
			error(503, 'The session analysis could not be stopped')
		}

		await runPromise(
			pipe(
				ingestion.discard(campaignId, ingestionId),
				match({
					onFailure: (failure) => {
						logFailure(failure)
						if (isCommitStartedIngestionDiscard(failure.cause)) {
							error(409, 'A session cannot be discarded after saving has started')
						}
						error(500, 'Unable to discard this session')
					},
					onSuccess: () => undefined
				})
			)
		)
		void listUncommittedSessionIngestions(campaignId).refresh()
	}
)

export const startCampaignImport = command(
	startCampaignImportInput,
	async (input): Promise<WorkflowReference> => {
		const reference = await startCampaignImportOperation(input)
		void listCampaignImports(input.campaignId).refresh()
		return reference
	}
)

export const retryCampaignImportAnalysis = command(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<WorkflowReference> =>
		retryCampaignImportWorkflowOperation('analysis', campaignId, ingestionId)
)

export const getCampaignImportAnalysisStatus = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<CampaignImportAnalysisWorkflowStatus> =>
		getCampaignImportWorkflowStatusOperation(
			'analysis',
			campaignId,
			ingestionId
		) as Promise<CampaignImportAnalysisWorkflowStatus>
)

export const getCampaignImport = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<CampaignImportDraft> =>
		getCampaignImportOperation(campaignId, ingestionId)
)

export const getCampaignImportReviewState = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<CampaignImportReviewState> =>
		getCampaignImportReviewStateOperation(campaignId, ingestionId)
)

export const saveCampaignImportReviewState = command(
	saveCampaignImportReviewStateInput,
	async (input) => {
		const state = await saveCampaignImportReviewStateOperation(input)
		getCampaignImportReviewState({
			campaignId: input.campaignId,
			ingestionId: input.ingestionId
		}).set(state)
		return state
	}
)

export const commitCampaignImport = command(
	commitCampaignImportInput,
	async (input): Promise<WorkflowReference> => {
		const reference = await commitCampaignImportOperation(input)
		void listCampaignImports(input.campaignId).refresh()
		return reference
	}
)

export const retryCampaignImportCommit = command(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<WorkflowReference> =>
		retryCampaignImportWorkflowOperation('commit', campaignId, ingestionId)
)

export const getCampaignImportCommitStatus = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<CampaignImportCommitWorkflowStatus> =>
		getCampaignImportWorkflowStatusOperation(
			'commit',
			campaignId,
			ingestionId
		) as Promise<CampaignImportCommitWorkflowStatus>
)

const loadCampaignImports = listCampaignImportsOperation

export const listCampaignImports = query(campaignId, loadCampaignImports)

export const getCampaignImportLifecycle = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }) => getCampaignImportLifecycleOperation(campaignId, ingestionId)
)

export const finishCampaignImport = command(
	campaignImportReferenceInput,
	async ({ campaignId, ingestionId }) => {
		await finishCampaignImportOperation(campaignId, ingestionId)
		void listCampaignImports(campaignId).refresh()
	}
)

export const discardCampaignImport = command(
	campaignImportReferenceInput,
	async ({ campaignId, ingestionId }) => {
		await discardCampaignImportOperation(campaignId, ingestionId)
		void listCampaignImports(campaignId).refresh()
	}
)

export const startCampaignImportChronology = command(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<WorkflowReference> =>
		startCampaignImportChronologyOperation(campaignId, ingestionId)
)

export const retryCampaignImportChronologyAnalysis = command(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<WorkflowReference> =>
		retryCampaignImportWorkflowOperation('chronology-analysis', campaignId, ingestionId)
)

export const getCampaignImportChronologyStatus = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<CampaignImportChronologyAnalysisWorkflowStatus> =>
		getCampaignImportWorkflowStatusOperation(
			'chronology-analysis',
			campaignId,
			ingestionId
		) as Promise<CampaignImportChronologyAnalysisWorkflowStatus>
)

export const getCampaignImportChronology = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<CampaignImportChronologyDraft> =>
		getCampaignImportChronologyOperation(campaignId, ingestionId)
)

export const commitCampaignImportChronology = command(
	commitCampaignImportChronologyInput,
	(input): Promise<WorkflowReference> => commitCampaignImportChronologyOperation(input)
)

export const retryCampaignImportChronologyCommit = command(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<WorkflowReference> =>
		retryCampaignImportWorkflowOperation('chronology-commit', campaignId, ingestionId)
)

export const getCampaignImportChronologyCommitStatus = query(
	campaignImportReferenceInput,
	({ campaignId, ingestionId }): Promise<CampaignImportChronologyCommitWorkflowStatus> =>
		getCampaignImportWorkflowStatusOperation(
			'chronology-commit',
			campaignId,
			ingestionId
		) as Promise<CampaignImportChronologyCommitWorkflowStatus>
)

const loadVaultDocuments = (id: string): Promise<VaultDocumentSummary[]> =>
	runPromise(
		pipe(
			vault.listDocuments(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to list vault documents')
				},
				onSuccess: (documents) => documents
			})
		)
	)

export const listDocuments = query(campaignId, loadVaultDocuments)

export const listDocumentsByType = query(
	documentsByTypeInput,
	async ({ campaignId, type }): Promise<VaultDocumentSummary[]> =>
		(await loadVaultDocuments(campaignId)).filter((document) => document.type === type)
)

const toDocumentView = ({
	id,
	title,
	type,
	content,
	currentRevisionId
}: VaultDocument): VaultDocumentView => ({
	id,
	title,
	type,
	content,
	currentRevisionId
})

export const getDocument = query(
	documentReference,
	({ campaignId, documentId }): Promise<VaultDocumentView> =>
		runPromise(
			pipe(
				vault.getDocument(campaignId, documentId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						if (failure.domain === 'vault' && failure.operation === 'getDocument') {
							error(404, `Document "${documentId}" was not found`)
						}

						logFailure(failure)
						error(500, 'Unable to load vault document')
					},
					onSuccess: toDocumentView
				})
			)
		)
)

export const listDocumentRevisions = query(
	documentReference,
	({ campaignId, documentId }): Promise<VaultRevisionMetadata[]> =>
		runPromise(
			pipe(
				vault.listDocumentRevisions(campaignId, documentId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						logFailure(failure)
						error(500, 'Unable to load document history')
					},
					onSuccess: (revisions) => revisions
				})
			)
		)
)

export const getDocumentRevision = query(
	revisionReference,
	({ campaignId, documentId, revisionId }): Promise<VaultRevision> =>
		runPromise(
			pipe(
				vault.getDocumentRevision(campaignId, documentId, revisionId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						if (failure.domain === 'revisionStorage' && failure.operation === 'getRevision') {
							error(404, `Revision "${revisionId}" was not found`)
						}

						logFailure(failure)
						error(500, 'Unable to load document revision')
					},
					onSuccess: (revision) => revision
				})
			)
		)
)

export const diffDocumentRevisions = query(
	revisionDiffInput,
	({ campaignId, documentId, toRevisionId, fromRevisionId }): Promise<RevisionDiff> =>
		runPromise(
			pipe(
				vault.diffDocumentRevisions(campaignId, documentId, toRevisionId, fromRevisionId),
				match({
					onFailure: (failure) => {
						if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
							error(404, `Campaign "${campaignId}" was not found`)
						}

						if (failure.domain === 'revisionStorage' && failure.operation === 'getRevision') {
							error(404, 'One of the requested revisions was not found')
						}

						logFailure(failure)
						error(500, 'Unable to compare document revisions')
					},
					onSuccess: (diff) => diff
				})
			)
		)
)

export const createDocument = command(createDocumentInput, (input) =>
	runPromise(
		pipe(
			vault.createDocument(input.campaignId, input),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'createDocument') {
						const reason =
							failure.cause && typeof failure.cause === 'object' && 'reason' in failure.cause
								? failure.cause.reason
								: undefined

						if (reason === 'pathExists') {
							error(409, `A document already exists at "${input.path}"`)
						}

						error(400, 'The document path is invalid')
					}

					logFailure(failure)
					error(500, 'Unable to create vault document')
				},
				onSuccess: (document) => {
					void listDocuments(input.campaignId).refresh()
					getDocument({
						campaignId: input.campaignId,
						documentId: document.id
					}).set(toDocumentView(document))
					return document
				}
			})
		)
	)
)

export const updateDocument = command(updateDocumentInput, (input) =>
	runPromise(
		pipe(
			vault.updateDocument(input.campaignId, input.documentId, {
				...input,
				expectedRevisionId: input.currentRevisionId
			}),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${input.documentId}" was not found`)
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'verifyBase') {
						error(409, 'This document changed after you opened it. Reload before saving.')
					}

					logFailure(failure)
					error(500, 'Unable to update vault document')
				},
				onSuccess: (document) => {
					void listDocuments(input.campaignId).refresh()
					getDocument({
						campaignId: input.campaignId,
						documentId: document.id
					}).set(toDocumentView(document))
					return document
				}
			})
		)
	)
)

export const editDocument = command(editDocumentInput, (input): Promise<VaultDocumentView> =>
	runPromise(
		pipe(
			vault.editDocument(input.campaignId, input.documentId, {
				title: input.title,
				content: input.content,
				expectedRevisionId: input.currentRevisionId
			}),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${input.documentId}" was not found`)
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'verifyBase') {
						error(409, 'This document changed after you opened it. Reload before saving.')
					}

					logFailure(failure)
					error(500, 'Unable to edit vault document')
				},
				onSuccess: (document) => {
					const view = toDocumentView(document)
					getDocument({
						campaignId: input.campaignId,
						documentId: input.documentId
					}).set(view)
					void listDocuments(input.campaignId).refresh()
					void listDocumentsByType({
						campaignId: input.campaignId,
						type: document.type
					}).refresh()
					void listDocumentRevisions({
						campaignId: input.campaignId,
						documentId: input.documentId
					}).refresh()
					return view
				}
			})
		)
	)
)

export const deleteDocument = command(deleteDocumentInput, (input) =>
	runPromise(
		pipe(
			vault.deleteDocument(input.campaignId, input.documentId, {
				expectedRevisionId: input.currentRevisionId
			}),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'vault' && failure.operation === 'getDocument') {
						error(404, `Document "${input.documentId}" was not found`)
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'verifyBase') {
						error(409, 'This document changed after you opened it. Reload before deleting.')
					}

					logFailure(failure)
					error(500, 'Unable to delete vault document')
				},
				onSuccess: () => {
					void listDocuments(input.campaignId).refresh()
				}
			})
		)
	)
)

export const restoreDocumentRevision = command(restoreRevisionInput, (input) =>
	runPromise(
		pipe(
			vault.restoreDocumentRevision(input.campaignId, input.documentId, input.revisionId, {
				expectedRevisionId: input.currentRevisionId
			}),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${input.campaignId}" was not found`)
					}

					if (failure.domain === 'revisionStorage' && failure.operation === 'getRevision') {
						error(404, `Revision "${input.revisionId}" was not found`)
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'verifyBase') {
						error(409, 'This document changed after its history loaded. Reload before restoring.')
					}

					if (failure.domain === 'vaultRevision' && failure.operation === 'restoreRevision') {
						const reason =
							failure.cause && typeof failure.cause === 'object' && 'reason' in failure.cause
								? failure.cause.reason
								: undefined

						if (reason === 'deletedSnapshot') {
							error(410, 'Deleted document snapshots cannot be restored')
						}

						error(422, 'This revision does not contain a valid document snapshot')
					}

					logFailure(failure)
					error(500, 'Unable to restore document revision')
				},
				onSuccess: (document) => {
					getDocument({
						campaignId: input.campaignId,
						documentId: input.documentId
					}).set(toDocumentView(document))
					void listDocumentRevisions({
						campaignId: input.campaignId,
						documentId: input.documentId
					}).refresh()
					void listDocuments(input.campaignId).refresh()
					void listDocumentsByType({
						campaignId: input.campaignId,
						type: document.type
					}).refresh()
					if (input.currentDocumentType !== document.type) {
						void listDocumentsByType({
							campaignId: input.campaignId,
							type: input.currentDocumentType
						}).refresh()
					}
					return document
				}
			})
		)
	)
)

export const reindexCampaignVault = command(campaignId, (id) =>
	runPromise(
		pipe(
			vault.reindexCampaign(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					logFailure(failure)
					error(500, 'Unable to reindex the campaign vault')
				},
				onSuccess: (documents) => {
					void listDocuments(id).refresh()
					return documents
				}
			})
		)
	)
)
