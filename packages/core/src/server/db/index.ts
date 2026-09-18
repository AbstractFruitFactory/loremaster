import { drizzle } from 'drizzle-orm/postgres-js'
import type { Effect } from 'effect/Effect'
import postgres from 'postgres'
import { withAdvisoryLocks, type AdvisoryLockConnection } from './advisory-lock.js'
import * as schema from './schema.js'

const connect = (databaseUrl: string) => {
	const client = postgres(databaseUrl)
	const advisoryClient = postgres(databaseUrl)
	return {
		client,
		advisoryClient,
		databaseUrl,
		database: drizzle(client, { schema })
	}
}

type DatabaseState = ReturnType<typeof connect>

let state: DatabaseState | undefined

const currentState = () => {
	if (!state) throw new Error('Core database has not been initialized')
	return state
}

export const db = new Proxy({} as DatabaseState['database'], {
	get: (_target, property) => Reflect.get(currentState().database, property)
})

const reserveAdvisoryConnection = async (): Promise<AdvisoryLockConnection> => {
	const connection = await currentState().advisoryClient.reserve()
	return {
		lock: async (key) => {
			await connection`select pg_advisory_lock(hashtextextended(${key}, 0))`
		},
		unlock: async (key) => {
			await connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`
		},
		release: () => connection.release()
	}
}

export const withDatabaseAdvisoryLocks = <Value, Error, Requirements>(
	keys: readonly string[],
	effect: () => Effect<Value, Error, Requirements>
) => withAdvisoryLocks(reserveAdvisoryConnection, keys, effect)

export const initializeDatabase = (databaseUrl: string) => {
	if (!databaseUrl) throw new Error('databaseUrl is required')
	if (state && state.databaseUrl !== databaseUrl) {
		throw new Error('Core database is already initialized with a different URL')
	}
	state ??= connect(databaseUrl)
	return state.database
}

export const closeDb = async () => {
	if (!state) return
	const active = state
	state = undefined
	const results = await Promise.allSettled([
		Promise.resolve().then(() => active.client.end()),
		Promise.resolve().then(() => active.advisoryClient.end())
	])
	const failures = results.flatMap((result) =>
		result.status === 'rejected' ? [result.reason] : []
	)
	if (failures.length) throw new AggregateError(failures, 'Failed to close database pools')
}
