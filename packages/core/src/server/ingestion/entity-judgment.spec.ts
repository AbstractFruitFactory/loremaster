import { fail, flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../vault/types.js'
import { judgeEntityIdentity, type EntityIdentityRequest } from './entity-judgment.js'
import type { ResolveSessionEntities } from '../ai/provider.js'
import { entityResolution } from './entity-resolution.js'
import type { ValidatedClaim } from './internal.js'

const document: VaultDocument = {
	id: 'dereka',
	title: 'Dereka Stonehand',
	path: 'NPCs/Dereka.md',
	type: 'npc',
	aliases: [],
	after: [],
	during: [],
	summary: 'Barbarian in the War of the Ages.',
	content: '# Dereka Stonehand\nServed in the War of the Ages.',
	links: [],
	currentRevisionId: 'revision-1'
}
const claim: ValidatedClaim = {
	claimId: 'claim-1',
	kind: 'stable-fact',
	eventTitle: null,
	certainty: 'explicit',
	content: 'Dereka served during the War of the Ages.',
	entityReferences: [{ label: 'Dereka', type: 'npc', role: 'subject' }],
	evidence: [
		{
			excerpt: 'Dereka served during the War of the Ages.',
			chunkId: 'chunk-1',
			startStringIndex: 0,
			endStringIndex: 42,
			startLine: 1,
			endLine: 1
		}
	]
}

const referencesFrom = (prompt: string): EntityIdentityRequest[] => JSON.parse(prompt).references

describe('entity identity judgment through AiProvider', () => {
	it('hands retrieved candidates and evidence to the AI provider before applying its selection', async () => {
		const judge = vi.fn<ResolveSessionEntities>(({ prompt }) =>
			succeed(
				referencesFrom(prompt).map((request) => ({
					referenceId: request.referenceId,
					kind: 'existing',
					targetId: 'document:dereka'
				}))
			)
		)
		const result = await runPromise(
			entityResolution({
				analysisModel: 'test-model',
				resolveSessionEntities: judge
			}).resolveClaims([claim], [document])
		)
		expect(judge).toHaveBeenCalledOnce()
		expect(referencesFrom(judge.mock.calls[0][0].prompt)[0]).toMatchObject({
			reference: 'Dereka',
			type: 'npc',
			evidence: expect.stringContaining('War of the Ages'),
			candidates: expect.arrayContaining([
				expect.objectContaining({
					targetId: 'document:dereka',
					title: 'Dereka Stonehand',
					provenance: 'partial-name',
					context: expect.stringContaining('War of the Ages')
				})
			])
		})
		expect(result[0].entities[0]).toMatchObject({
			kind: 'existing',
			document: { id: 'dereka' },
			method: 'model'
		})
	})

	it('keeps retrieval candidates for review when a provider returns an unknown target', async () => {
		const judge: ResolveSessionEntities = ({ prompt }) =>
			succeed(
				referencesFrom(prompt).map(({ referenceId }) => ({
					referenceId,
					kind: 'existing',
					targetId: 'document:invented'
				}))
			)
		const result = await runPromise(
			entityResolution({
				analysisModel: 'test-model',
				resolveSessionEntities: judge
			}).resolveClaims([claim], [document])
		)
		expect(result[0].entities[0]).toMatchObject({
			kind: 'unresolved',
			match: { candidates: [{ documentId: 'dereka' }] }
		})
	})

	it('preserves explicit uncertainty even without a provider-supplied shortlist', async () => {
		const judge: ResolveSessionEntities = ({ prompt }) =>
			succeed(
				referencesFrom(prompt).map(({ referenceId }) => ({
					referenceId,
					kind: 'defer',
					candidateIds: [],
					reason: 'The evidence does not establish identity.'
				}))
			)
		const result = await runPromise(
			entityResolution({
				analysisModel: 'test-model',
				resolveSessionEntities: judge
			}).resolveClaims([claim], [document])
		)
		expect(result[0].entities[0]).toMatchObject({
			kind: 'unresolved',
			match: { candidates: [{ documentId: 'dereka' }] }
		})
	})

	it('propagates provider failures instead of creating an entity', async () => {
		const error = {
			domain: 'ai' as const,
			operation: 'resolveSessionEntities' as const,
			cause: 'unavailable'
		}
		const result = await runPromise(
			flip(
				entityResolution({
					analysisModel: 'test-model',
					resolveSessionEntities: () => fail(error)
				}).resolveClaims([claim], [document])
			)
		)
		expect(result).toEqual(error)
	})

	it('adapts legacy LLM outcomes without changing the provider prompt shape', async () => {
		const resolveSessionEntities = vi.fn(() =>
			succeed([
				{ referenceId: 'one', kind: 'existing' as const, targetId: 'document:dereka' },
				{ referenceId: 'two', kind: 'create' as const },
				{
					referenceId: 'three',
					kind: 'defer' as const,
					candidateIds: ['document:dereka'],
					reason: 'Ambiguous name.'
				}
			])
		)
		const result = await runPromise(
			judgeEntityIdentity({ analysisModel: 'test-model', resolveSessionEntities }, [])
		)
		expect(resolveSessionEntities).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'test-model',
				prompt: JSON.stringify({ references: [] }, null, 2)
			})
		)
		expect(result).toEqual([
			{ referenceId: 'one', kind: 'existing', targetId: 'document:dereka' },
			{ referenceId: 'two', kind: 'none-of-these' },
			{
				referenceId: 'three',
				kind: 'insufficient-evidence',
				candidateIds: ['document:dereka'],
				reason: 'Ambiguous name.'
			}
		])
	})
})
