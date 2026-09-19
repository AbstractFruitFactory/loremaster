import { error } from '@sveltejs/kit'
import { match, runPromise, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { campaign, campaignImport } from '#lib/server/app.js'
import {
	CampaignImportWorkflowRetryError,
	getIngestionDbosAdapter
} from '#lib/server/dbos/client.js'
import { mapIngestionWorkflowStatus } from '#lib/server/dbos/status.js'
import { logFailure } from '#lib/server/failure.js'
import {
	isCampaignImportOperationLeaseBusy,
	isCampaignImportPermanenceError,
	isCampaignImportReviewLocked,
	isCampaignImportReviewLockBusy,
	isCampaignImportReviewRevisionConflict,
	isCommitStartedIngestionDiscard,
	isImmutableIngestionConflict
} from '@loremaster/core/server/ingestion/storage'
import type { Failure } from '@loremaster/core/server/failure'
import type {
	CampaignImportAnalyzeInput,
	CampaignImportChronologyCommitInput,
	CampaignImportChronologyDraft,
	CampaignImportCommitInput,
	CampaignImportDraft,
	CampaignImportReviewState,
	CampaignImportReviewUpdateInput,
	CampaignImportSummary
} from '@loremaster/core/server/ingestion/types'
import {
	campaignImportWorkflowDescriptors,
	campaignImportWorkflowKinds,
	type CampaignImportWorkflowKind,
	type CampaignImportWorkflowProgress,
	type WorkflowReference
} from '@loremaster/core/workflows/contracts'
import {
	deriveCampaignImportLifecycle,
	type CampaignImportLifecycle,
	type CampaignImportWorkflowLifecycleStatus,
	type CampaignImportWorkflowStatuses
} from './lifecycle.js'
import { canRunCampaignImportCleanup } from './cleanup.js'
import { campaignImportCommitHttpError } from './failure.js'
import {
	withCampaignImportOperationLease,
	withCampaignImportOrchestrationLock
} from './serialization.js'

const runCore = <Value>(
	effect: Effect<Value, Failure>,
	onFailure: (failure: Failure) => never
): Promise<Value> =>
	runPromise(
		pipe(
			effect,
			match({
				onFailure,
				onSuccess: (value) => value
			})
		)
	)

const authorizeCampaignImport = (campaignId: string) =>
	runCore(campaign.getCampaign(campaignId), (failure) => {
		if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
			error(404, `Campaign "${campaignId}" was not found`)
		}
		logFailure(failure)
		error(500, 'Unable to access this campaign')
	})

const readLifecycleState = (campaignId: string, ingestionId: string) =>
	runCore(campaignImport.commitOperations.getLifecycleState(campaignId, ingestionId), (failure) => {
		logFailure(failure)
		error(404, 'Campaign import was not found')
	})

const cleanupStarted = (campaignId: string, ingestionId: string) =>
	runCore(campaignImport.commitOperations.isCleanupStarted(campaignId, ingestionId), (failure) => {
		logFailure(failure)
		error(500, 'Unable to verify campaign import cleanup state')
	})

const rejectAfterCleanupStarted = async (campaignId: string, ingestionId: string) => {
	if (await cleanupStarted(campaignId, ingestionId)) {
		error(409, 'This campaign import is already being finished')
	}
}

const withCampaignImportMutationLease = <Value>(
	campaignId: string,
	ingestionId: string,
	operation: () => Promise<Value>
) =>
	withCampaignImportOrchestrationLock(campaignId, ingestionId, () =>
		withCampaignImportOperationLease(
			{
				acquire: () =>
					runCore(
						campaignImport.commitOperations.acquireOperationLease(campaignId, ingestionId),
						(failure) => {
							logFailure(failure)
							if (isCampaignImportOperationLeaseBusy(failure.cause)) {
								error(409, 'Another campaign import operation is already in progress')
							}
							error(503, 'Campaign import operation coordination is temporarily unavailable')
						}
					),
				release: (lease) =>
					runCore(
						campaignImport.commitOperations.releaseOperationLease(campaignId, ingestionId, lease),
						(failure) => {
							logFailure(failure)
							error(503, 'Unable to release campaign import operation coordination')
						}
					)
			},
			operation
		)
	)

const workflowStatus = async (
	kind: CampaignImportWorkflowKind,
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportWorkflowLifecycleStatus> => {
	const descriptor = campaignImportWorkflowDescriptors[kind]
	const workflowId = descriptor.workflowId(campaignId, ingestionId)
	try {
		const dbos = await getIngestionDbosAdapter()
		return mapIngestionWorkflowStatus<unknown, CampaignImportWorkflowProgress>({
			kind: kind === 'analysis' || kind === 'chronology-analysis' ? 'analysis' : 'commit',
			reference: { campaignId, ingestionId, workflowId },
			...(await dbos.getWorkflowState<CampaignImportWorkflowProgress>(workflowId))
		})
	} catch (cause) {
		console.error(`[campaign-import-${kind}.status]`, cause)
		error(503, 'Campaign import workflow status is temporarily unavailable')
	}
}

export const getCampaignImportWorkflowStatuses = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportWorkflowStatuses> => {
	const statuses = await Promise.all(
		campaignImportWorkflowKinds.map(async (kind) => [
			kind,
			await workflowStatus(kind, campaignId, ingestionId)
		])
	)
	return Object.fromEntries(statuses) as CampaignImportWorkflowStatuses
}

export const startCampaignImportOperation = async (
	input: CampaignImportAnalyzeInput
): Promise<WorkflowReference> => {
	await authorizeCampaignImport(input.campaignId)
	const allocatedIngestionId = input.ingestionId ?? campaignImport.allocateIngestionId()
	return withCampaignImportMutationLease(input.campaignId, allocatedIngestionId, async () => {
		await rejectAfterCleanupStarted(input.campaignId, allocatedIngestionId)
		await runCore(
			campaignImport.persistRequest({ ...input, ingestionId: allocatedIngestionId }),
			(failure) => {
				logFailure(failure)
				if (isImmutableIngestionConflict(failure.cause)) {
					error(409, 'This import ID is already used by a different request')
				}
				error(500, 'Unable to persist this campaign import')
			}
		)
		try {
			const dbos = await getIngestionDbosAdapter()
			const workflowId = await dbos.enqueueCampaignImport(
				'analysis',
				input.campaignId,
				allocatedIngestionId
			)
			return {
				campaignId: input.campaignId,
				ingestionId: allocatedIngestionId,
				workflowId
			}
		} catch (cause) {
			console.error('[campaign-import-analysis.enqueue]', cause)
			error(503, 'Campaign import analysis is temporarily unavailable')
		}
	})
}

export const retryCampaignImportWorkflowOperation = async (
	kind: CampaignImportWorkflowKind,
	campaignId: string,
	ingestionId: string
): Promise<WorkflowReference> => {
	await authorizeCampaignImport(campaignId)
	return withCampaignImportMutationLease(campaignId, ingestionId, async () => {
		await rejectAfterCleanupStarted(campaignId, ingestionId)
		const state = await readLifecycleState(campaignId, ingestionId)
		if (kind === 'commit' && !state.commitRequested) {
			error(404, 'Campaign import commit was not found')
		}
		if (kind === 'chronology-analysis' && !state.completion) {
			error(409, 'Campaign import chronology cannot start before the base import completes')
		}
		if (kind === 'chronology-commit' && !state.chronologyCommitData) {
			error(404, 'Campaign import chronology commit was not found')
		}
		try {
			const dbos = await getIngestionDbosAdapter()
			const workflowId = await dbos.retryCampaignImport(kind, campaignId, ingestionId)
			if (kind === 'chronology-analysis') {
				await runCore(
					campaignImport.commitOperations.recordChronologyDispatch({
						schemaVersion: 1,
						kind: 'campaign-import-chronology-dispatch',
						campaignId,
						ingestionId,
						status: 'dispatched',
						updatedAt: new Date().toISOString()
					}),
					(failure) => {
						logFailure(failure)
						error(500, 'Unable to record chronology dispatch')
					}
				)
			}
			return { campaignId, ingestionId, workflowId }
		} catch (cause) {
			if (cause instanceof CampaignImportWorkflowRetryError) {
				error(409, `The ${kind} workflow cannot be retried after it is ${cause.lifecycle}`)
			}
			console.error(`[campaign-import-${kind}.retry]`, cause)
			error(503, 'Campaign import workflow retry is temporarily unavailable')
		}
	})
}

export const startCampaignImportChronologyOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<WorkflowReference> => {
	await authorizeCampaignImport(campaignId)
	return withCampaignImportMutationLease(campaignId, ingestionId, async () => {
		await rejectAfterCleanupStarted(campaignId, ingestionId)
		const state = await readLifecycleState(campaignId, ingestionId)
		if (!state.completion) {
			error(409, 'Campaign import chronology cannot start before the base import completes')
		}
		try {
			const dbos = await getIngestionDbosAdapter()
			const workflowId = await dbos.enqueueCampaignImport(
				'chronology-analysis',
				campaignId,
				ingestionId
			)
			await runCore(
				campaignImport.commitOperations.recordChronologyDispatch({
					schemaVersion: 1,
					kind: 'campaign-import-chronology-dispatch',
					campaignId,
					ingestionId,
					status: 'dispatched',
					updatedAt: new Date().toISOString()
				}),
				(failure) => {
					logFailure(failure)
					error(500, 'Unable to record chronology dispatch')
				}
			)
			return { campaignId, ingestionId, workflowId }
		} catch (cause) {
			console.error('[campaign-import-chronology-analysis.enqueue]', cause)
			error(503, 'Campaign import chronology is temporarily unavailable')
		}
	})
}

export const getCampaignImportWorkflowStatusOperation = async (
	kind: CampaignImportWorkflowKind,
	campaignId: string,
	ingestionId: string
) => {
	await authorizeCampaignImport(campaignId)
	await readLifecycleState(campaignId, ingestionId)
	return workflowStatus(kind, campaignId, ingestionId)
}

export const getCampaignImportLifecycleOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportLifecycle> => {
	await authorizeCampaignImport(campaignId)
	const [state, statuses] = await Promise.all([
		readLifecycleState(campaignId, ingestionId),
		getCampaignImportWorkflowStatuses(campaignId, ingestionId)
	])
	return deriveCampaignImportLifecycle(state, statuses)
}

export const listCampaignImportsOperation = async (
	campaignId: string
): Promise<CampaignImportSummary[]> => {
	await authorizeCampaignImport(campaignId)
	const summaries = await runCore(campaignImport.commitOperations.list(campaignId), (failure) => {
		logFailure(failure)
		error(500, 'Unable to list campaign imports')
	})
	return Promise.all(
		summaries.map(async (summary) => {
			const state = await readLifecycleState(campaignId, summary.ingestionId)
			const statuses = await getCampaignImportWorkflowStatuses(campaignId, summary.ingestionId)
			const lifecycle = deriveCampaignImportLifecycle(state, statuses)
			return { ...summary, phase: lifecycle.phase, canDiscard: lifecycle.canDiscard }
		})
	)
}

export const getCampaignImportOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportDraft> => {
	await authorizeCampaignImport(campaignId)
	return runCore(campaignImport.getDraft(campaignId, ingestionId), (failure) => {
		logFailure(failure)
		error(404, 'Campaign import analysis was not found')
	})
}

export const getCampaignImportReviewStateOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportReviewState> => {
	await authorizeCampaignImport(campaignId)
	return runCore(campaignImport.getReviewState(campaignId, ingestionId), (failure) => {
		logFailure(failure)
		error(404, 'Campaign import review state was not found')
	})
}

export const saveCampaignImportReviewStateOperation = async (
	input: CampaignImportReviewUpdateInput
): Promise<CampaignImportReviewState> => {
	await authorizeCampaignImport(input.campaignId)
	return runCore(campaignImport.saveReviewState(input), (failure) => {
		logFailure(failure)
		if (isCampaignImportReviewRevisionConflict(failure.cause)) {
			error(409, 'This review changed after it was loaded. Reload before saving.')
		}
		if (isCampaignImportReviewLocked(failure.cause)) {
			error(409, 'This review cannot change after committing has started.')
		}
		if (isCampaignImportReviewLockBusy(failure.cause)) {
			error(409, 'This review is being changed elsewhere. Try again.')
		}
		if (failure.domain === 'ingestion' && failure.operation === 'saveCampaignImportReviewState') {
			error(400, 'This campaign import review state is invalid.')
		}
		error(500, 'Unable to save campaign import review state')
	})
}

export const commitCampaignImportOperation = async (
	input: CampaignImportCommitInput
): Promise<WorkflowReference> => {
	await authorizeCampaignImport(input.campaignId)
	return withCampaignImportMutationLease(input.campaignId, input.ingestionId, async () => {
		await rejectAfterCleanupStarted(input.campaignId, input.ingestionId)
		await runCore(campaignImport.commitOperations.persistCommitData(input), (failure) => {
			logFailure(failure)
			const mapped = campaignImportCommitHttpError(failure)
			if (mapped) error(mapped.status, mapped.message)
			error(500, 'Unable to persist this import selection')
		})
		try {
			const dbos = await getIngestionDbosAdapter()
			const workflowId = await dbos.enqueueCampaignImport(
				'commit',
				input.campaignId,
				input.ingestionId
			)
			return {
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				workflowId
			}
		} catch (cause) {
			console.error('[campaign-import-commit.enqueue]', cause)
			error(503, 'Campaign import commit is temporarily unavailable')
		}
	})
}

export const getCampaignImportChronologyOperation = async (
	campaignId: string,
	ingestionId: string
): Promise<CampaignImportChronologyDraft> => {
	await authorizeCampaignImport(campaignId)
	return runCore(campaignImport.chronology.getDraft(campaignId, ingestionId), (failure) => {
		logFailure(failure)
		error(404, 'Campaign import chronology was not found')
	})
}

export const commitCampaignImportChronologyOperation = async (
	input: CampaignImportChronologyCommitInput
): Promise<WorkflowReference> => {
	await authorizeCampaignImport(input.campaignId)
	return withCampaignImportMutationLease(input.campaignId, input.ingestionId, async () => {
		await rejectAfterCleanupStarted(input.campaignId, input.ingestionId)
		await runCore(campaignImport.chronology.persistCommitData(input), (failure) => {
			logFailure(failure)
			if (isImmutableIngestionConflict(failure.cause)) {
				error(409, 'A different chronology selection is already being committed')
			}
			error(500, 'Unable to persist this chronology selection')
		})
		try {
			const dbos = await getIngestionDbosAdapter()
			const workflowId = await dbos.enqueueCampaignImport(
				'chronology-commit',
				input.campaignId,
				input.ingestionId
			)
			return {
				campaignId: input.campaignId,
				ingestionId: input.ingestionId,
				workflowId
			}
		} catch (cause) {
			console.error('[campaign-import-chronology-commit.enqueue]', cause)
			error(503, 'Campaign import chronology commit is temporarily unavailable')
		}
	})
}

export const discardCampaignImportOperation = async (campaignId: string, ingestionId: string) => {
	await authorizeCampaignImport(campaignId)
	const state = await readLifecycleState(campaignId, ingestionId)
	if (state.commitRequested) {
		error(409, 'A campaign import cannot be discarded after committing has started')
	}
	try {
		const dbos = await getIngestionDbosAdapter()
		await dbos.cancelAnalysis(
			campaignImportWorkflowDescriptors.analysis.workflowId(campaignId, ingestionId)
		)
	} catch (cause) {
		console.error('[campaign-import-analysis.discard-cancel]', cause)
		error(503, 'The campaign import analysis could not be stopped')
	}
	await runCore(campaignImport.commitOperations.discard(campaignId, ingestionId), (failure) => {
		logFailure(failure)
		if (isCommitStartedIngestionDiscard(failure.cause)) {
			error(409, 'A campaign import cannot be discarded after committing has started')
		}
		error(500, 'Unable to discard this campaign import')
	})
}

export const finishCampaignImportOperation = async (campaignId: string, ingestionId: string) => {
	await authorizeCampaignImport(campaignId)
	return withCampaignImportMutationLease(campaignId, ingestionId, async () => {
		const [started, statuses] = await Promise.all([
			cleanupStarted(campaignId, ingestionId),
			getCampaignImportWorkflowStatuses(campaignId, ingestionId)
		])
		const state = started ? undefined : await readLifecycleState(campaignId, ingestionId)
		if (
			!canRunCampaignImportCleanup({
				cleanupStarted: started,
				...(state ? { state } : {}),
				workflows: statuses
			})
		) {
			error(409, 'A campaign import cannot be finished before every workflow is terminal')
		}
		if (!started) {
			await runCore(
				campaignImport.commitOperations.markCleanupStarted(campaignId, ingestionId),
				(failure) => {
					logFailure(failure)
					error(500, 'Unable to start campaign import cleanup')
				}
			)
		}
		await runCore(campaignImport.commitOperations.cleanup(campaignId, ingestionId), (failure) => {
			logFailure(failure)
			if (isCampaignImportPermanenceError(failure.cause)) {
				error(409, 'Campaign import evidence is not permanently retained')
			}
			error(500, 'Unable to finish this campaign import')
		})
	})
}
