import { acquireUseRelease, orDie, suspend, tryPromise, type Effect } from 'effect/Effect'
import { failure, type Failure } from '../failure.js'

export type AdvisoryLockConnection = {
	lock: (key: string) => Promise<void>
	unlock: (key: string) => Promise<void>
	release: () => void | Promise<void>
}

type AdvisoryLockResource = {
	connection: AdvisoryLockConnection
	keys: string[]
}

const normalizedKeys = (keys: readonly string[]) => [...new Set(keys)].sort()

const releaseResource = async ({ connection, keys }: AdvisoryLockResource) => {
	const failures: unknown[] = []
	for (const key of keys.toReversed()) {
		try {
			await connection.unlock(key)
		} catch (cause) {
			failures.push(cause)
		}
	}
	try {
		await connection.release()
	} catch (cause) {
		failures.push(cause)
	}
	if (failures.length) throw new AggregateError(failures, 'Failed to release advisory locks')
}

const acquireResource = async (
	reserve: () => Promise<AdvisoryLockConnection>,
	keys: string[]
): Promise<AdvisoryLockResource> => {
	const connection = await reserve()
	const acquired: string[] = []
	try {
		for (const key of keys) {
			await connection.lock(key)
			acquired.push(key)
		}
		return { connection, keys: acquired }
	} catch (cause) {
		try {
			await releaseResource({ connection, keys: acquired })
		} catch (releaseCause) {
			throw new AggregateError([cause, releaseCause], 'Failed to acquire advisory locks')
		}
		throw cause
	}
}

export const withAdvisoryLocks = <Value, Error, Requirements>(
	reserve: () => Promise<AdvisoryLockConnection>,
	keys: readonly string[],
	effect: () => Effect<Value, Error, Requirements>
): Effect<Value, Error | Failure<'database', 'withAdvisoryLocks'>, Requirements> =>
	suspend(() => {
		const normalized = normalizedKeys(keys)
		if (!normalized.length) return effect()
		return acquireUseRelease(
			tryPromise({
				try: () => acquireResource(reserve, normalized),
				catch: (cause) => failure('database', 'withAdvisoryLocks', cause)
			}),
			effect,
			(resource) =>
				orDie(
					tryPromise({
						try: () => releaseResource(resource),
						catch: (cause) => failure('database', 'releaseAdvisoryLocks', cause)
					})
				)
		)
	})
