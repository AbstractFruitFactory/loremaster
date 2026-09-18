import type { Failure } from '../server/failure.js'
import { match, runPromise, type Effect } from 'effect/Effect'
import type { WorkflowError } from './contracts.js'

const isFailure = (value: unknown): value is Failure =>
	typeof value === 'object' &&
	value !== null &&
	'domain' in value &&
	typeof value.domain === 'string' &&
	'operation' in value &&
	typeof value.operation === 'string'

export const serializeWorkflowFailure = (value: unknown): WorkflowError =>
	isFailure(value)
		? {
				code: `${value.domain}.${value.operation}`,
				message: 'A workflow stage could not be completed.'
			}
		: {
				code: 'workflow.failed',
				message: 'The workflow could not be completed.'
			}

export class WorkflowStageError extends Error {
	readonly code: string

	constructor(failure: WorkflowError) {
		super(failure.message)
		this.name = 'WorkflowStageError'
		this.code = failure.code
	}
}

export const workflowStageError = (value: unknown) =>
	new WorkflowStageError(serializeWorkflowFailure(value))

export const runWorkflowEffect = async <Value>(
	effect: Effect<Value, unknown, never>
): Promise<Value> => {
	const result = await runPromise(
		match(effect, {
			onFailure: (failure) => ({
				ok: false as const,
				error: serializeWorkflowFailure(failure)
			}),
			onSuccess: (value) => ({ ok: true as const, value })
		})
	)
	if (!result.ok) throw new WorkflowStageError(result.error)
	return result.value
}
