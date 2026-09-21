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

// Workflow errors are persisted by DBOS, so keep them generic. Log only bounded
// diagnostic fields here; an underlying API error may contain private source text.
const logWorkflowFailure = (value: unknown) => {
	const cause = isFailure(value) ? value.cause : value
	const details: Record<string, string | number> = {
		code: serializeWorkflowFailure(value).code
	}
	if (cause instanceof Error && /^[A-Za-z][\w.]{0,63}$/.test(cause.name)) {
		details.causeType = cause.name
	}
	if (typeof cause === 'object' && cause !== null) {
		if (
			'status' in cause &&
			typeof cause.status === 'number' &&
			Number.isInteger(cause.status) &&
			cause.status >= 100 &&
			cause.status <= 599
		) {
			details.status = cause.status
		}
		if (
			'code' in cause &&
			typeof cause.code === 'string' &&
			/^[A-Za-z][\w.]{0,63}$/.test(cause.code)
		) {
			details.providerCode = cause.code
		}
		if (
			'reason' in cause &&
			typeof cause.reason === 'string' &&
			/^[A-Za-z][\w.]{0,63}$/.test(cause.reason)
		) {
			details.reason = cause.reason
		}
	}
	console.error('[workflow-stage-failure]', details)
}

export const runWorkflowEffect = async <Value>(
	effect: Effect<Value, unknown, never>
): Promise<Value> => {
	const result = await runPromise(
		match(effect, {
			onFailure: (failure) => {
				logWorkflowFailure(failure)
				return { ok: false as const, error: serializeWorkflowFailure(failure) }
			},
			onSuccess: (value) => ({ ok: true as const, value })
		})
	)
	if (!result.ok) throw new WorkflowStageError(result.error)
	return result.value
}
