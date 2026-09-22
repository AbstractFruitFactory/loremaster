import { JEV_REQUEST_BYTE_BUDGET } from './jev.js'
import { flip, runPromise } from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiProvider } from '../index.js'
import { judgeEntityIdentity } from '../../ingestion/entity-judgment.js'
import type { SessionEntityResolutionRequest } from '../../ingestion/types.js'

const reference: SessionEntityResolutionRequest = {
	referenceId: 'mention-1',
	reference: 'Dereka',
	type: 'npc',
	evidence: 'Dereka served in the War of the Ages.',
	candidates: [
		{
			targetId: 'document:dereka',
			title: 'Dereka Stonehand',
			type: 'npc',
			provenance: 'partial-name',
			context: 'A barbarian who served in the War of the Ages.'
		}
	]
}
const answer = (
	choice = 'candidate_0',
	probabilities = { candidate_0: 0.98, none_of_these: 0.01, insufficient_evidence: 0.01 }
) => ({ type: 'choice', choice, probabilities, confidence: 0.9 })
const response = (answers: Record<string, unknown> = { reference_0: answer() }) =>
	Response.json({ model: 'jev-test-version', answers })
const setup = () => {
	vi.stubEnv('TYPESAFE_API_KEY', 'test-typesafe-key')
	vi.stubEnv('OPENAI_API_KEY', '')
	const fetch = vi.fn().mockResolvedValue(response())
	vi.stubGlobal('fetch', fetch)
	return { fetch, provider: createAiProvider() }
}
const resolve = (provider: ReturnType<typeof createAiProvider>, references = [reference]) =>
	provider.resolveSessionEntities({ model: provider.models.entityResolution, references })

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('Jev identity provider', () => {
	it('uses typed Choices and preserves the full distribution without requiring OpenAI credentials', async () => {
		const { fetch, provider } = setup()
		const result = await runPromise(resolve(provider))
		expect(result[0]).toMatchObject({
			kind: 'existing',
			targetId: 'document:dereka',
			judgment: {
				model: 'jev-test-version',
				probabilities: { 'document:dereka': 0.98, none_of_these: 0.01, insufficient_evidence: 0.01 }
			}
		})
		const [url, init] = fetch.mock.calls[0]
		expect(url).toBe('https://api.typesafe.ai/v1/systemone')
		expect(init.headers.Authorization).toBe('Bearer test-typesafe-key')
		const body = JSON.parse(init.body)
		expect(body.state.references).toEqual([reference])
		expect(body.questions.reference_0.instructions).toContain('references[0]')
		expect(Object.keys(body.questions.reference_0.criteria)).toEqual([
			'candidate_0',
			'none_of_these',
			'insufficient_evidence'
		])
	})

	it('checks credentials at execution time, not runtime construction', async () => {
		const { provider, fetch } = setup()
		const pending = resolve(provider)
		vi.stubEnv('TYPESAFE_API_KEY', '')
		const error = await runPromise(flip(pending))
		expect(error).toMatchObject({ domain: 'ai', operation: 'resolveSessionEntities' })
		expect(String(error.cause)).toContain('TYPESAFE_API_KEY')
		expect(fetch).not.toHaveBeenCalled()
		vi.stubEnv('TYPESAFE_API_KEY', 'later-key')
		await runPromise(pending)
		expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer later-key')
	})

	it('fails only the OpenAI operation when its key is missing', async () => {
		const { provider, fetch } = setup()
		const error = await runPromise(
			flip(provider.generateText({ model: provider.models.documentSummary, prompt: 'Summarize.' }))
		)
		expect(error).toMatchObject({
			operation: 'generateText',
			cause: { variable: 'OPENAI_API_KEY' }
		})
		expect(fetch).not.toHaveBeenCalled()
	})

	it('routes an OpenAI identity model back to OpenAI without needing a TypeSafe key', async () => {
		const { fetch } = setup()
		vi.stubEnv('TYPESAFE_API_KEY', '')
		const provider = createAiProvider({ entityResolution: 'gpt-test-identity' })
		expect(provider.models.entityResolution).toBe('gpt-test-identity')
		const error = await runPromise(flip(resolve(provider)))
		expect(error).toMatchObject({
			cause: { variable: 'OPENAI_API_KEY', model: 'gpt-test-identity' }
		})
		expect(fetch).not.toHaveBeenCalled()
	})

	it('defers a weak match in pipeline policy despite a high provider confidence', async () => {
		const { fetch, provider } = setup()
		fetch.mockResolvedValue(
			response({
				reference_0: {
					...answer('candidate_0', {
						candidate_0: 0.6,
						none_of_these: 0.3,
						insufficient_evidence: 0.1
					}),
					confidence: 1
				}
			})
		)
		const decisions = await runPromise(
			judgeEntityIdentity(
				{
					...provider,
					analysisModel: 'unused',
					entityResolutionModel: provider.models.entityResolution
				},
				[reference]
			)
		)
		expect(decisions[0]).toMatchObject({ kind: 'insufficient-evidence', candidateIds: [] })
	})

	it.each([
		[
			'none_of_these',
			{ candidate_0: 0.01, none_of_these: 0.98, insufficient_evidence: 0.01 },
			'none-of-these'
		],
		[
			'insufficient_evidence',
			{ candidate_0: 0.01, none_of_these: 0.01, insufficient_evidence: 0.98 },
			'insufficient-evidence'
		]
	])('preserves the %s outcome', async (choice, probabilities, kind) => {
		const { fetch, provider } = setup()
		fetch.mockResolvedValue(response({ reference_0: answer(choice, probabilities) }))
		const decisions = await runPromise(
			judgeEntityIdentity({ ...provider, analysisModel: provider.models.entityResolution }, [
				reference
			])
		)
		expect(decisions[0].kind).toBe(kind)
	})

	it.each([
		{},
		{ reference_0: { ...answer(), choice: 'invented' } },
		{
			reference_0: answer('candidate_0', {
				candidate_0: 0.8,
				none_of_these: 0.8,
				insufficient_evidence: 0
			})
		},
		{
			reference_0: answer('candidate_0', {
				candidate_0: 0.1,
				none_of_these: 0.8,
				insufficient_evidence: 0.1
			})
		}
	])('rejects malformed answers without producing creation decisions', async (answers) => {
		const { fetch, provider } = setup()
		fetch.mockResolvedValue(response(answers))
		expect(await runPromise(flip(resolve(provider)))).toMatchObject({
			operation: 'resolveSessionEntities'
		})
	})

	it('batches references with distinct per-question state paths', async () => {
		const { fetch, provider } = setup()
		fetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init.body)
			return response(Object.fromEntries(Object.keys(body.questions).map((key) => [key, answer()])))
		})
		const references = Array.from({ length: 17 }, (_, i) => ({
			...reference,
			referenceId: `mention-${i}`
		}))
		const decisions = await runPromise(resolve(provider, references))
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(decisions.map(({ referenceId }) => referenceId)).toEqual(
			references.map(({ referenceId }) => referenceId)
		)
		expect(JSON.parse(fetch.mock.calls[0][1].body).questions.reference_15.instructions).toContain(
			'references[15]'
		)
	})

	it('budgets the full UTF-8 request including repeated candidate context without truncating evidence', async () => {
		const { fetch, provider } = setup()
		const references = Array.from({ length: 3 }, (_, i) => ({
			...reference,
			referenceId: `large-${i}`,
			candidates: [{ ...reference.candidates[0], context: '界'.repeat(5_000) }]
		}))
		fetch.mockImplementation(async (_url, init) => {
			expect(Buffer.byteLength(init.body, 'utf8')).toBeLessThanOrEqual(JEV_REQUEST_BYTE_BUDGET)
			const body = JSON.parse(init.body)
			expect(body.state.references).toHaveLength(1)
			expect(body.questions.reference_0.instructions).toContain('references[0]')
			expect(body.state.references[0].candidates[0].context).toBe('界'.repeat(5_000))
			return response()
		})
		const decisions = await runPromise(resolve(provider, references))
		expect(decisions.map(({ referenceId }) => referenceId)).toEqual(
			references.map(({ referenceId }) => referenceId)
		)
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it.each([400, 413])(
		'splits server-rejected batches on HTTP %s and keeps reference order',
		async (status) => {
			const { fetch, provider } = setup()
			const references = Array.from({ length: 3 }, (_, i) => ({
				...reference,
				referenceId: `split-${i}`
			}))
			fetch.mockImplementation(async (_url, init) => {
				const body = JSON.parse(init.body)
				if (body.state.references.length > 1)
					return Response.json({ detail: { error_type: 'max_tokens_exceeded' } }, { status })
				return response()
			})
			const decisions = await runPromise(resolve(provider, references))
			expect(decisions.map(({ referenceId }) => referenceId)).toEqual(
				references.map(({ referenceId }) => referenceId)
			)
			expect(
				fetch.mock.calls.map(([, init]) => JSON.parse(init.body).state.references.length)
			).toEqual([3, 2, 1, 1, 1])
		}
	)

	it('preflights an oversized singleton before sending any batches', async () => {
		const { fetch, provider } = setup()
		const large = {
			...reference,
			referenceId: 'oversized',
			evidence: 'x'.repeat(JEV_REQUEST_BYTE_BUDGET)
		}
		expect(await runPromise(flip(resolve(provider, [reference, large])))).toMatchObject({
			cause: { reason: 'jevReferenceTooLarge', referenceId: 'oversized' }
		})
		expect(fetch).not.toHaveBeenCalled()
	})

	it('fails a server-rejected singleton without endlessly retrying or creating an entity', async () => {
		const { fetch, provider } = setup()
		fetch.mockResolvedValue(
			Response.json({ detail: { error_type: 'max_tokens_exceeded' } }, { status: 400 })
		)
		expect(await runPromise(flip(resolve(provider)))).toMatchObject({
			cause: { reason: 'jevReferenceTooLarge', referenceId: reference.referenceId }
		})
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('does not split unrelated HTTP 400 errors', async () => {
		const { fetch, provider } = setup()
		fetch.mockResolvedValue(
			Response.json({ detail: { error_type: 'invalid_model' } }, { status: 400 })
		)
		expect(
			await runPromise(flip(resolve(provider, [reference, { ...reference, referenceId: 'two' }])))
		).toMatchObject({ cause: { status: 400 } })
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('does not retry an authentication failure or expose its response body', async () => {
		const { fetch, provider } = setup()
		fetch.mockResolvedValue(new Response('private details', { status: 401 }))
		const error = await runPromise(flip(resolve(provider)))
		expect(String(error.cause)).toContain('HTTP 401')
		expect(String(error.cause)).not.toContain('private details')
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('retries a transient overload', async () => {
		const { fetch, provider } = setup()
		fetch
			.mockResolvedValueOnce(new Response(null, { status: 529 }))
			.mockResolvedValueOnce(response())
		expect((await runPromise(resolve(provider)))[0].kind).toBe('existing')
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('does not call the API for an empty batch', async () => {
		const { provider, fetch } = setup()
		vi.stubEnv('TYPESAFE_API_KEY', '')
		expect(await runPromise(resolve(provider, []))).toEqual([])
		expect(fetch).not.toHaveBeenCalled()
	})
})
