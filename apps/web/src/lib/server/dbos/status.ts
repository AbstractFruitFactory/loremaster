import type { WorkflowStatus } from '@dbos-inc/dbos-sdk'
import {
	workflowLifecycleFromStatus,
	type WorkflowLifecycle,
	type WorkflowProgress,
	type WorkflowReference,
	type WorkflowStatusResult
} from '@loremaster/core/workflows/contracts'

export type RetryableWorkflowLifecycle = Extract<
	WorkflowLifecycle,
	'not-started' | 'failed' | 'cancelled'
>

export const isWorkflowRetryable = (
	lifecycle: WorkflowLifecycle
): lifecycle is RetryableWorkflowLifecycle =>
	lifecycle === 'not-started' || lifecycle === 'failed' || lifecycle === 'cancelled'

export const mapIngestionWorkflowStatus = <
	Result,
	Progress extends { stage: string; completed: number; total: number } = WorkflowProgress
>({
	kind,
	reference,
	status,
	progress
}: {
	kind: 'analysis' | 'commit'
	reference: WorkflowReference
	status: WorkflowStatus | undefined
	progress: Progress | null
}): WorkflowStatusResult<Result, Progress> => {
	if (!status) {
		return {
			...reference,
			lifecycle: 'not-started',
			error: {
				code: 'workflow.notFound',
				message: 'The workflow has not been enqueued.'
			},
			refreshDocuments: false,
			retryable: isWorkflowRetryable('not-started')
		}
	}

	const lifecycle = workflowLifecycleFromStatus(status.status)
	const failedStage = progress?.stage as WorkflowStatusResult<Result, Progress>['failedStage']
	return {
		...reference,
		lifecycle,
		...(progress ? { progress } : {}),
		...(lifecycle === 'succeeded' ? { result: status.output as Result } : {}),
		...(lifecycle === 'failed' || lifecycle === 'cancelled'
			? {
					error: {
						code: lifecycle === 'failed' ? 'workflow.failed' : 'workflow.cancelled',
						message:
							lifecycle === 'failed'
								? 'The workflow could not be completed.'
								: 'The workflow was cancelled.'
					},
					...(progress ? { failedStage } : {})
				}
			: {}),
		refreshDocuments: kind === 'commit' && lifecycle === 'succeeded',
		retryable: isWorkflowRetryable(lifecycle)
	}
}
