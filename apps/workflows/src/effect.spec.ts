import { fail, succeed } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { runEffect } from './effect.js'

describe('workflow Effect boundary', () => {
	it('returns successful values', async () => {
		await expect(runEffect(succeed({ value: 1 }))).resolves.toEqual({ value: 1 })
	})

	it('throws a serializable sanitized stage error', async () => {
		const error = await runEffect(
			fail({
				domain: 'vault',
				operation: 'updateDocument',
				cause: { secret: 'private document text' }
			})
		).catch((cause: unknown) => cause)

		expect(error).toMatchObject({
			name: 'WorkflowStageError',
			code: 'vault.updateDocument',
			message: 'A workflow stage could not be completed.'
		})
		expect(JSON.stringify(error)).not.toContain('private document text')
	})
})
