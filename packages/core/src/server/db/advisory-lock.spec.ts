import * as Fiber from 'effect/Fiber'
import { fail, flatMap, flip, never, runFork, runPromise, succeed, sync } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { withAdvisoryLocks, type AdvisoryLockConnection } from './advisory-lock.js'

const connection = (
	events: string[],
	options: { failLock?: string } = {}
): AdvisoryLockConnection => ({
	lock: async (key) => {
		events.push(`lock:${key}`)
		if (key === options.failLock) throw new Error(`failed ${key}`)
	},
	unlock: async (key) => {
		events.push(`unlock:${key}`)
	},
	release: () => {
		events.push('release')
	}
})

describe('multi-key advisory locks', () => {
	it('uses one reservation and releases sorted unique keys in reverse', async () => {
		const events: string[] = []
		const reserve = async () => {
			events.push('reserve')
			return connection(events)
		}

		await runPromise(
			withAdvisoryLocks(reserve, ['z', 'a', 'm', 'a'], () =>
				sync(() => {
					events.push('use')
				})
			)
		)

		expect(events).toEqual([
			'reserve',
			'lock:a',
			'lock:m',
			'lock:z',
			'use',
			'unlock:z',
			'unlock:m',
			'unlock:a',
			'release'
		])
	})

	it('releases acquired keys after partial acquisition failure', async () => {
		const events: string[] = []
		const failure = await runPromise(
			flip(
				withAdvisoryLocks(
					async () => {
						events.push('reserve')
						return connection(events, { failLock: 'm' })
					},
					['z', 'a', 'm'],
					() => succeed(undefined)
				)
			)
		)

		expect(failure).toMatchObject({
			domain: 'database',
			operation: 'withAdvisoryLocks'
		})
		expect(events).toEqual(['reserve', 'lock:a', 'lock:m', 'unlock:a', 'release'])
	})

	it('releases every key when the use effect is interrupted', async () => {
		const events: string[] = []
		let signalStarted = () => {}
		const started = new Promise<void>((resolve) => {
			signalStarted = resolve
		})
		const fiber = runFork(
			withAdvisoryLocks(
				async () => {
					events.push('reserve')
					return connection(events)
				},
				['document', 'path'],
				() =>
					flatMap(
						sync(() => {
							events.push('use')
							signalStarted()
						}),
						() => never
					)
			)
		)

		await started
		await runPromise(Fiber.interrupt(fiber))

		expect(events).toEqual([
			'reserve',
			'lock:document',
			'lock:path',
			'use',
			'unlock:path',
			'unlock:document',
			'release'
		])
	})

	it('releases every key when the use effect fails', async () => {
		const events: string[] = []

		await runPromise(
			flip(
				withAdvisoryLocks(
					async () => {
						events.push('reserve')
						return connection(events)
					},
					['path', 'document'],
					() => fail('use failed')
				)
			)
		)

		expect(events).toEqual([
			'reserve',
			'lock:document',
			'lock:path',
			'unlock:path',
			'unlock:document',
			'release'
		])
	})
})
