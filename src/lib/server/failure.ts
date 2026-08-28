import { fail as  _fail, type Effect } from 'effect/Effect'

export type Failure<Domain extends string = string, Operation extends string = string> = {
	readonly domain: Domain
	readonly operation: Operation
	readonly cause?: unknown
}

export const failure = <Domain extends string, Operation extends string>(
	domain: Domain,
	operation: Operation,
	cause?: unknown
): Failure<Domain, Operation> => ({
	domain,
	operation,
	cause
})

export const fail = <Domain extends string, Operation extends string>(
	domain: Domain,
	operation: Operation,
	cause?: unknown
): Effect<never, Failure<Domain, Operation>> => _fail(failure(domain, operation, cause))
