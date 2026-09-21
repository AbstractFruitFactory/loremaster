import { fail, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { runEffect } from './effect.js'

describe('workflow Effect boundary', () => {
	it('returns successful values', async () => {
		await expect(runEffect(succeed({ value: 1 }))).resolves.toEqual({ value: 1 })
	})

	it('throws a serializable sanitized stage error', async () => {
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
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
		expect(logger).toHaveBeenCalledWith('[workflow-stage-failure]', {
			code: 'vault.updateDocument'
		})
		logger.mockRestore()
	})

	it('logs safe provider diagnostics without exposing the error message', async () => {
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
		const cause = Object.assign(new Error('Private source text and API key'), {
			name: 'RateLimitError',
			status: 429,
			code: 'rate_limit_exceeded'
		})

		await expect(
			runEffect(fail({ domain: 'ai', operation: 'analyzeSessionChunk', cause }))
		).rejects.toMatchObject({ code: 'ai.analyzeSessionChunk' })
		expect(logger).toHaveBeenCalledWith('[workflow-stage-failure]', {
			code: 'ai.analyzeSessionChunk',
			causeType: 'RateLimitError',
			status: 429,
			providerCode: 'rate_limit_exceeded'
		})
		expect(JSON.stringify(logger.mock.calls)).not.toContain('Private source text')
		logger.mockRestore()
	})
})
