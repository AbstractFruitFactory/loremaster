import type { WorkflowStatus } from '@dbos-inc/dbos-sdk'
import {
	workflowLifecycleFromStatus,
	type WorkflowProgress,
	type WorkflowReference,
	type WorkflowStatusResult
} from '@loremaster/core/workflows/contracts'

export const mapIngestionWorkflowStatus = <Result>({
	kind,
	reference,
	status,
	progress
}: {
	kind: 'analysis' | 'commit'
	reference: WorkflowReference
	status: WorkflowStatus | undefined
	progress: WorkflowProgress | null
}): WorkflowStatusResult<Result> => {
	if (!status) {
		return {
			...reference,
			lifecycle: 'not-started',
			error: {
				code: 'workflow.notFound',
				message: 'The workflow has not been enqueued.'
			},
			refreshDocuments: false,
			retryable: true
		}
	}

	const lifecycle = workflowLifecycleFromStatus(status.status)
	return {
		...reference,
		lifecycle,
		...(progress ? { progress } : {}),
		...(lifecycle === 'succeeded' ? { result: status.output as Result } : {}),
		...(lifecycle === 'failed'
			? {
					error: {
						code: 'workflow.failed',
						message: 'The workflow could not be completed.'
					}
				}
			: {}),
		refreshDocuments: kind === 'commit' && lifecycle === 'succeeded',
		retryable: false
	}
}
