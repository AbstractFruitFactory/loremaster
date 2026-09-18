import { DBOS } from '@dbos-inc/dbos-sdk'
import { chunkTranscript } from '@loremaster/core/server/ingestion/chunking'
import type {
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
	COMMIT_WORKFLOW_NAME,
	WORKFLOW_PROGRESS_EVENT,
	type AnalysisWorkflowInput,
	type CommitWorkflowInput,
	type WorkflowLifecycleStage
} from '@loremaster/core/workflows/contracts'
import { runEffect } from './effect.js'
import { runtime } from './runtime.js'

const publishProgress = (stage: WorkflowLifecycleStage, completed: number, total: number) =>
	DBOS.setEvent(WORKFLOW_PROGRESS_EVENT, { stage, completed, total })

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

		const result = {
			documents,
			sessionDocumentId: prepared.plan.sessionDocumentId
		}
		await publishProgress('completed', mutationIds.length, mutationIds.length)
		return result
	},
	{ name: COMMIT_WORKFLOW_NAME }
)
