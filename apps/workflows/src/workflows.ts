import { DBOS } from '@dbos-inc/dbos-sdk'
import { chunkTranscript } from '@loremaster/core/server/ingestion/chunking'
import type {
	CampaignImportChronologyBuildResult,
	CampaignImportChronologyCommitData,
	CampaignImportChronologyCommitPlanData,
	CampaignImportChronologyCommitResult,
	CampaignImportChronologyDraft,
	CampaignImportCommitData,
	CampaignImportCommitPlanData,
	CampaignImportCommitResult,
	CampaignImportDraft,
	CampaignImportRequestData,
	CampaignImportSourceAnalysis,
	SessionAnalysisStageResult,
	SessionChronologyStageResult,
	SessionCommitData,
	SessionIngestionDraft,
	SessionTranscriptData,
	SessionIngestionResult,
	SessionProposalBuildResult
} from '@loremaster/core/server/ingestion/types'
import type { VaultDocument } from '@loremaster/core/server/vault/types'
import {
	ANALYSIS_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_ANALYSIS_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_WORKFLOW_NAME,
	CAMPAIGN_IMPORT_COMMIT_WORKFLOW_NAME,
	COMMIT_WORKFLOW_NAME,
	WORKFLOW_PROGRESS_EVENT,
	campaignImportWorkflowDescriptors,
	type AnalysisWorkflowInput,
	type CampaignImportAnalysisWorkflowInput,
	type CampaignImportChronologyAnalysisWorkflowInput,
	type CampaignImportChronologyCommitWorkflowInput,
	type CampaignImportCommitWorkflowInput,
	type CampaignImportWorkflowLifecycleStage,
	type CommitWorkflowInput,
	type WorkflowLifecycleStage
} from '@loremaster/core/workflows/contracts'
import { runEffect } from './effect.js'
import { runtime } from './runtime.js'

const publishProgress = (
	stage: WorkflowLifecycleStage | CampaignImportWorkflowLifecycleStage,
	completed: number,
	total: number
) => DBOS.setEvent(WORKFLOW_PROGRESS_EVENT, { stage, completed, total })

export const analyzeTranscript = DBOS.registerWorkflow(
	async ({ campaignId, ingestionId }: AnalysisWorkflowInput) => {
		await publishProgress('loading-transcript-data', 0, 1)

		const transcriptData = await DBOS.runStep<SessionTranscriptData>(
			() => runEffect(runtime.ingestion.getTranscriptData(campaignId, ingestionId)),
			{ name: 'load-transcript-data', retriesAllowed: true }
		)

		const chunks = chunkTranscript(transcriptData.transcript)
		const total = chunks.length + 5
		const chunkResults: SessionAnalysisStageResult[] = []

		for (const [index, chunk] of chunks.entries()) {
			await publishProgress('analyzing-transcript', index, total)
			chunkResults.push(
				await DBOS.runStep<SessionAnalysisStageResult>(
					() =>
						runEffect(
							runtime.ingestion.analysisStages.analyzeChunk(transcriptData.transcript, chunk)
						),
					{
						name: `analyze-transcript-chunk-${index + 1}`,
						retriesAllowed: true
					}
				)
			)
		}

		const combined = await DBOS.runStep<SessionAnalysisStageResult>(
			() => runEffect(runtime.ingestion.analysisStages.combineChunkAnalyses(chunkResults)),
			{ name: 'combine-transcript-chunks' }
		)
		await publishProgress('auditing-events', chunks.length + 1, total)
		const audit = await DBOS.runStep<SessionAnalysisStageResult>(
			() =>
				runEffect(
					runtime.ingestion.analysisStages.auditEvents(transcriptData.transcript, combined.claims)
				),
			{ name: 'audit-session-events', retriesAllowed: true }
		)
		await publishProgress('resolving-entities', chunks.length + 2, total)
		const documents = await DBOS.runStep<VaultDocument[]>(
			() =>
				runEffect(
					runtime.ingestion.analysisStages.retrieveAnalysisContext(campaignId, audit.claims)
				),
			{ name: 'retrieve-analysis-context', retriesAllowed: true }
		)
		const proposalBuild = await DBOS.runStep<SessionProposalBuildResult>(
			() => runEffect(runtime.ingestion.analysisStages.buildProposals(audit.claims, documents)),
			{ name: 'resolve-entities-and-build-proposals', retriesAllowed: true }
		)
		await publishProgress('inferring-chronology', chunks.length + 3, total)
		const chronology = await DBOS.runStep<SessionChronologyStageResult>(
			() =>
				runEffect(
					runtime.ingestion.analysisStages.inferChronology(
						transcriptData.transcript,
						proposalBuild.proposals,
						documents
					)
				),
			{ name: 'infer-session-chronology', retriesAllowed: true }
		)
		const draft = await DBOS.runStep<SessionIngestionDraft>(
			() =>
				runEffect(
					runtime.ingestion.analysisStages.buildDraft(
						transcriptData,
						audit.claims,
						proposalBuild.proposals,
						chronology.chronology,
						chronology.coverage,
						[...combined.warnings, ...audit.warnings, ...chronology.warnings]
					)
				),
			{ name: 'build-ingestion-draft' }
		)
		await publishProgress('persisting-draft', chunks.length + 4, total)
		await DBOS.runStep(
			() =>
				runEffect(runtime.ingestion.analysisStages.persistDraft(draft, transcriptData.transcript)),
			{ name: 'persist-ingestion-draft', retriesAllowed: true }
		)
		await publishProgress('completed', total, total)
		return draft
	},
	{ name: ANALYSIS_WORKFLOW_NAME }
)

export const commit = DBOS.registerWorkflow(
	async ({ campaignId, ingestionId }: CommitWorkflowInput): Promise<SessionIngestionResult> => {
		await publishProgress('loading-transcript-data', 0, 1)
		const commitData = await DBOS.runStep<SessionCommitData>(
			() => runEffect(runtime.ingestion.getCommitData(campaignId, ingestionId)),
			{ name: 'load-commit-data', retriesAllowed: true }
		)
		await publishProgress('planning-commit', 0, 1)
		const prepared = await DBOS.runStep<
			Parameters<typeof runtime.ingestion.applyCommitMutation>[1]
		>(() => runEffect(runtime.ingestion.planCommit(commitData)), {
			name: 'plan-session-commit',
			retriesAllowed: true
		})
		const mutationIds = runtime.ingestion.commitMutationIds(prepared)
		const documents: SessionIngestionResult['documents'] = []

		for (const [index, mutationId] of mutationIds.entries()) {
			await publishProgress('applying-mutations', index, mutationIds.length)
			const result = await DBOS.runStep<SessionIngestionResult>(
				() => runEffect(runtime.ingestion.applyCommitMutation(commitData, prepared, mutationId)),
				{ name: `apply-commit-mutation-${mutationId}`, retriesAllowed: true }
			)
			documents.push(...result.documents)
		}

		const sessionDocumentId = prepared.plan.sessionDocumentId
		if (!sessionDocumentId) {
			throw new Error('Commit plan is missing its session document ID')
		}

		const result = {
			documents,
			sessionDocumentId
		}
		await publishProgress('completed', mutationIds.length, mutationIds.length)
		return result
	},
	{ name: COMMIT_WORKFLOW_NAME }
)

export const analyzeCampaignImport = DBOS.registerWorkflow(
	async ({
		campaignId,
		ingestionId
	}: CampaignImportAnalysisWorkflowInput): Promise<CampaignImportDraft> => {
		await publishProgress('loading-import-data', 0, 1)
		const request = await DBOS.runStep<CampaignImportRequestData>(
			() => runEffect(runtime.campaignImport.getRequest(campaignId, ingestionId)),
			{ name: 'load-campaign-import-data', retriesAllowed: true }
		)
		const analyses: CampaignImportSourceAnalysis[] = []
		for (const [index, source] of request.sources.entries()) {
			await publishProgress('analyzing-import-sources', index, request.sources.length)
			analyses.push(
				await DBOS.runStep<CampaignImportSourceAnalysis>(
					() =>
						runEffect(
							runtime.campaignImport.analyzePersistedSource(
								campaignId,
								ingestionId,
								source.sourceRevisionId
							)
						),
					{ name: `analyze-campaign-import-source-${index + 1}`, retriesAllowed: true }
				)
			)
		}
		await publishProgress(
			'reconciling-import-sources',
			request.sources.length,
			request.sources.length
		)
		await publishProgress('building-import-draft', request.sources.length, request.sources.length)
		const draft = await DBOS.runStep<CampaignImportDraft>(
			() => runEffect(runtime.campaignImport.buildDraft(request, analyses)),
			{ name: 'build-campaign-import-draft', retriesAllowed: true }
		)
		await DBOS.runStep(() => runEffect(runtime.campaignImport.persistDraft(draft)), {
			name: 'persist-campaign-import-draft',
			retriesAllowed: true
		})
		await publishProgress('completed', request.sources.length, request.sources.length)
		return draft
	},
	{ name: CAMPAIGN_IMPORT_ANALYSIS_WORKFLOW_NAME }
)

export const commitCampaignImport = DBOS.registerWorkflow(
	async ({
		campaignId,
		ingestionId
	}: CampaignImportCommitWorkflowInput): Promise<CampaignImportCommitResult> => {
		await publishProgress('loading-import-data', 0, 1)
		const data = await DBOS.runStep<CampaignImportCommitData>(
			() =>
				runEffect(runtime.campaignImport.commitOperations.getCommitData(campaignId, ingestionId)),
			{ name: 'load-campaign-import-commit-data', retriesAllowed: true }
		)
		await publishProgress('planning-commit', 0, 1)
		const prepared = await DBOS.runStep<CampaignImportCommitPlanData>(
			() => runEffect(runtime.campaignImport.commitOperations.planCommit(data)),
			{ name: 'plan-campaign-import-commit', retriesAllowed: true }
		)
		const mutationIds = runtime.campaignImport.commitOperations.commitMutationIds(prepared)
		for (const [index, mutationId] of mutationIds.entries()) {
			await publishProgress('applying-mutations', index, mutationIds.length)
			await DBOS.runStep(
				() =>
					runEffect(
						runtime.campaignImport.commitOperations.applyCommitMutation(data, prepared, mutationId)
					),
				{ name: `apply-campaign-import-mutation-${mutationId}`, retriesAllowed: true }
			)
		}
		await publishProgress('finalizing-import', mutationIds.length, mutationIds.length)
		const result = await DBOS.runStep<CampaignImportCommitResult>(
			() => runEffect(runtime.campaignImport.commitOperations.finalizeCommit(data, prepared)),
			{ name: 'finalize-campaign-import', retriesAllowed: true }
		)
		const chronologyDescriptor = campaignImportWorkflowDescriptors['chronology-analysis']
		let chronologyDispatched = false
		try {
			await DBOS.runStep(
				async () => {
					await DBOS.startWorkflow(analyzeCampaignImportChronology, {
						workflowID: chronologyDescriptor.workflowId(campaignId, ingestionId),
						queueName: chronologyDescriptor.queueName,
						duplicationPolicy: 'return-existing'
					})({ campaignId, ingestionId })
				},
				{ name: 'dispatch-campaign-import-chronology', retriesAllowed: true }
			)
			chronologyDispatched = true
			await DBOS.runStep(
				() =>
					runEffect(
						runtime.campaignImport.commitOperations.recordChronologyDispatch({
							schemaVersion: 1,
							kind: 'campaign-import-chronology-dispatch',
							campaignId,
							ingestionId,
							status: 'dispatched',
							updatedAt: new Date().toISOString()
						})
					),
				{ name: 'record-campaign-import-chronology-dispatch', retriesAllowed: true }
			)
		} catch {
			if (chronologyDispatched) {
				console.error('[campaign-import-chronology.dispatch] Unable to record dispatch success')
			} else {
				try {
					await DBOS.runStep(
						() =>
							runEffect(
								runtime.campaignImport.commitOperations.recordChronologyDispatch({
									schemaVersion: 1,
									kind: 'campaign-import-chronology-dispatch',
									campaignId,
									ingestionId,
									status: 'failed',
									updatedAt: new Date().toISOString(),
									error: {
										code: 'chronology.dispatchFailed',
										message: 'Chronology analysis could not be dispatched.'
									}
								})
							),
						{ name: 'record-campaign-import-chronology-dispatch-failure', retriesAllowed: true }
					)
				} catch {
					console.error('[campaign-import-chronology.dispatch] Unable to record dispatch failure')
				}
			}
		}
		await publishProgress('completed', mutationIds.length, mutationIds.length)
		return result
	},
	{ name: CAMPAIGN_IMPORT_COMMIT_WORKFLOW_NAME }
)

export const analyzeCampaignImportChronology = DBOS.registerWorkflow(
	async ({
		campaignId,
		ingestionId
	}: CampaignImportChronologyAnalysisWorkflowInput): Promise<CampaignImportChronologyDraft> => {
		await publishProgress('inferring-import-chronology', 0, 1)
		const built = await DBOS.runStep<CampaignImportChronologyBuildResult>(
			() => runEffect(runtime.campaignImport.chronology.buildDraft(campaignId, ingestionId)),
			{ name: 'build-campaign-import-chronology-draft', retriesAllowed: true }
		)
		await DBOS.runStep(() => runEffect(runtime.campaignImport.chronology.persistDraft(built)), {
			name: 'persist-campaign-import-chronology-draft',
			retriesAllowed: true
		})
		await publishProgress('completed', 1, 1)
		return built.draft
	},
	{ name: CAMPAIGN_IMPORT_CHRONOLOGY_ANALYSIS_WORKFLOW_NAME }
)

export const commitCampaignImportChronology = DBOS.registerWorkflow(
	async ({
		campaignId,
		ingestionId
	}: CampaignImportChronologyCommitWorkflowInput): Promise<CampaignImportChronologyCommitResult> => {
		await publishProgress('loading-import-data', 0, 1)
		const data = await DBOS.runStep<CampaignImportChronologyCommitData>(
			() => runEffect(runtime.campaignImport.chronology.getCommitData(campaignId, ingestionId)),
			{ name: 'load-campaign-import-chronology-commit-data', retriesAllowed: true }
		)
		await publishProgress('planning-chronology-commit', 0, 1)
		const prepared = await DBOS.runStep<CampaignImportChronologyCommitPlanData>(
			() => runEffect(runtime.campaignImport.chronology.planCommit(data)),
			{ name: 'plan-campaign-import-chronology-commit', retriesAllowed: true }
		)
		const mutationIds = runtime.campaignImport.chronology.commitMutationIds(prepared)
		for (const [index, mutationId] of mutationIds.entries()) {
			await publishProgress('applying-chronology-mutations', index, mutationIds.length)
			await DBOS.runStep(
				() =>
					runEffect(
						runtime.campaignImport.chronology.applyCommitMutation(data, prepared, mutationId)
					),
				{
					name: `apply-campaign-import-chronology-mutation-${mutationId}`,
					retriesAllowed: true
				}
			)
		}
		await publishProgress('finalizing-chronology', mutationIds.length, mutationIds.length)
		const result = await DBOS.runStep<CampaignImportChronologyCommitResult>(
			() => runEffect(runtime.campaignImport.chronology.finalizeCommit(data, prepared)),
			{ name: 'finalize-campaign-import-chronology', retriesAllowed: true }
		)
		await publishProgress('completed', mutationIds.length, mutationIds.length)
		return result
	},
	{ name: CAMPAIGN_IMPORT_CHRONOLOGY_COMMIT_WORKFLOW_NAME }
)
