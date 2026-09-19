import { fail, flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyzeSessionChunk, ValidateSessionClaims } from '../ai/provider.js'
import type { VaultDocument } from '../vault/types.js'
import {
	campaignImportClaimFingerprint,
	campaignImportContentHash,
	campaignImportSourceId,
	campaignImportSourceRevisionId
} from './ids.js'
import { campaignImportAnalysis } from './import-analysis.js'
import { ImmutableIngestionConflictError } from './storage.js'
import type {
	CampaignImportClaim,
	CampaignImportDraft,
	CampaignImportReviewState,
	CampaignImportSourceInput,
	ExtractedSessionClaim
} from './types.js'

const acceptingValidator: ValidateSessionClaims = ({ prompt }) => {
	const candidates = JSON.parse(prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]') as {
		candidateId: string
		certainty: 'explicit' | 'inferred'
		entityReferences: { referenceId: string }[]
	}[]
	return succeed(
		candidates.map(({ candidateId, certainty, entityReferences }) => ({
			candidateId,
			accepted: true,
			certainty,
			reason: 'supported' as const,
			referenceValidations: entityReferences.map(({ referenceId }) => ({
				referenceId,
				accepted: true
			}))
		}))
	)
}

const source = (index: number, content: string): CampaignImportSourceInput => ({
	displayName: `lore/mara-${index}.md`,
	title: `Mara ${index}`,
	mediaType: 'text/markdown',
	content
})

const analyzerFor =
	(
		claimForLine: (content: string) => Omit<ExtractedSessionClaim, 'evidence'>
	): AnalyzeSessionChunk =>
	({ prompt, system }) => {
		expect(system).toContain('numbered source document')
		expect(prompt).toContain('## Source document')
		expect(prompt).toContain('Source ID:')
		expect(prompt).toContain('Source revision ID:')
		const match = prompt.match(/^(\d+) \| (.+)$/m)!
		return succeed([
			{
				...claimForLine(match[2]!),
				evidence: [{ startLine: Number(match[1]), endLine: Number(match[1]) }]
			}
		])
	}

const harness = (
	analyzeSessionChunk: AnalyzeSessionChunk,
	options: {
		acceptedFingerprints?: Set<string>
		documents?: VaultDocument[]
		draftWriteFailures?: number
	} = {}
) => {
	let saved: CampaignImportDraft | undefined
	let savedReview: CampaignImportReviewState | undefined
	let savedRequest: import('./types.js').CampaignImportRequestData | undefined
	const savedSources = new Map<string, string>()
	const draftWrites: CampaignImportDraft[] = []
	let draftWriteFailures = options.draftWriteFailures ?? 0
	const inferCampaignImportChronology = vi.fn()
	const ai = {
		analysisModel: 'analysis-model',
		analyzeSessionChunk,
		validateSessionClaims: acceptingValidator,
		repairSessionClaimEvidence: () => succeed([]),
		resolveSessionEntities: () => succeed([]),
		inferCampaignImportChronology
	}
	const operations = campaignImportAnalysis({
		ai,
		history: {
			getAcceptedClaimFingerprints: () => succeed(options.acceptedFingerprints ?? new Set()),
			recordProvenance: () => succeed(undefined),
			recordChronologyProvenance: () => succeed(undefined),
			persistSourceRevisions: () => succeed(undefined),
			verifyPermanence: () => succeed(undefined),
			verifyChronologyPermanence: () => succeed(undefined)
		},
		storage: {
			writeCampaignImportData: (request, sources) => {
				if (savedRequest) {
					const { createdAt: _savedCreatedAt, ...savedMetadata } = savedRequest
					const { createdAt: _nextCreatedAt, ...nextMetadata } = request
					const sameContent =
						sources.length === savedSources.size &&
						sources.every((source) => savedSources.get(source.sourceRevisionId) === source.content)
					if (JSON.stringify(savedMetadata) !== JSON.stringify(nextMetadata) || !sameContent) {
						return fail({
							domain: 'ingestionStorage' as const,
							operation: 'writeCampaignImportData' as const,
							cause: new ImmutableIngestionConflictError()
						})
					}
					return succeed(savedRequest)
				}
				savedRequest = request
				for (const source of sources) savedSources.set(source.sourceRevisionId, source.content)
				return succeed(request)
			},
			readCampaignImportData: () => succeed(savedRequest!),
			readCampaignImportSource: (_campaignId, _sourceId, sourceRevisionId) =>
				succeed(savedSources.get(sourceRevisionId)!),
			writeCampaignImportDraft: (draft) => {
				saved = draft
				draftWrites.push(structuredClone(draft))
				if (draftWriteFailures > 0) {
					draftWriteFailures -= 1
					return fail({
						domain: 'ingestionStorage' as const,
						operation: 'writeCampaignImportDraft' as const,
						cause: { reason: 'simulatedPostWriteFailure' }
					})
				}
				return succeed(undefined)
			},
			readCampaignImportDraft: () => succeed(saved!),
			initializeCampaignImportReviewState: (state) => {
				savedReview ??= structuredClone(state)
				return succeed(undefined)
			},
			readCampaignImportReviewState: () => succeed(savedReview!),
			updateCampaignImportReviewState: (state) => {
				savedReview = structuredClone(state)
				return succeed(state)
			}
		},
		retrieveAnalysisDocuments: () => succeed(options.documents ?? []),
		vault: {
			getDocuments: () => succeed(options.documents ?? []),
			createDocument: () => succeed({} as never),
			updateDocument: () => succeed({} as never)
		}
	})
	return {
		operations,
		inferCampaignImportChronology,
		getSaved: () => saved,
		getReview: () => savedReview,
		getRequest: () => savedRequest,
		getDraftWrites: () => draftWrites
	}
}

describe('campaign import analysis', () => {
	it('consolidates five source claims for Mara Vale into one provenance-rich proposal', async () => {
		const analyzer = analyzerFor((content) => ({
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content,
			entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
		}))
		const { operations, getSaved, getRequest } = harness(analyzer)
		const sources = Array.from({ length: 5 }, (_, index) =>
			source(index + 1, `Mara Vale knows secret ${index + 1}.`)
		)
		const draft = await runPromise(
			operations.analyze({
				ingestionId: 'import-1',
				campaignId: 'campaign',
				sources
			})
		)

		expect(getSaved()).toEqual(draft)
		expect(getRequest()).not.toHaveProperty('title')
		expect(draft).not.toHaveProperty('title')
		expect(draft.claims).toHaveLength(5)
		expect(new Set(draft.claims.map(({ claimId }) => claimId)).size).toBe(5)
		expect(new Set(draft.claims.map(({ claimFingerprint }) => claimFingerprint)).size).toBe(5)
		expect(draft.proposals).toHaveLength(1)
		expect(draft.proposals[0]).toMatchObject({
			operation: 'create-entity',
			documentType: 'npc',
			title: 'Mara Vale'
		})
		expect(draft.proposals[0]!.claimIds).toHaveLength(5)
		expect(draft.proposals[0]!.evidence).toHaveLength(5)
		expect(new Set(draft.proposals[0]!.evidence.map(({ sourceId }) => sourceId))).toEqual(
			new Set(draft.sources.map(({ sourceId }) => sourceId))
		)
		expect(
			draft.proposals[0]!.evidence.every(({ sourceRevisionId }) => Boolean(sourceRevisionId))
		).toBe(true)
		expect(draft.proposals.some(({ documentType }) => documentType === 'session')).toBe(false)
		expect(draft).not.toHaveProperty('review')
	})

	it('merges an exact duplicate claim across sources while retaining both evidence records', async () => {
		const analyzer = analyzerFor((content) => ({
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content,
			entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
		}))
		const { operations } = harness(analyzer)
		const duplicate = 'Mara Vale carries a blue lantern.'
		const draft = await runPromise(
			operations.analyze({
				ingestionId: 'import-duplicate',
				campaignId: 'campaign',
				title: 'Duplicate lore',
				sources: [source(1, duplicate), source(2, duplicate)]
			})
		)

		expect(draft.claims).toHaveLength(1)
		expect(draft.claims[0]!.evidence).toHaveLength(2)
		expect(new Set(draft.claims[0]!.evidence.map(({ sourceId }) => sourceId)).size).toBe(2)
		expect(
			new Set(draft.claims[0]!.evidence.map(({ sourceRevisionId }) => sourceRevisionId)).size
		).toBe(2)
		expect(draft.proposals).toHaveLength(1)
		expect(draft.proposals[0]!.claimIds).toEqual([draft.claims[0]!.claimId])
		expect(draft.proposals[0]!.evidence).toHaveLength(2)
	})

	it('keeps contradictory cross-source claims separate', async () => {
		const analyzer = analyzerFor((content) => ({
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content,
			entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
		}))
		const { operations } = harness(analyzer)
		const draft = await runPromise(
			operations.analyze({
				ingestionId: 'import-contradiction',
				campaignId: 'campaign',
				title: 'Conflicting lore',
				sources: [source(1, 'Mara Vale is alive.'), source(2, 'Mara Vale is not alive.')]
			})
		)

		expect(draft.claims.map(({ content }) => content).sort()).toEqual(
			['Mara Vale is alive.', 'Mara Vale is not alive.'].sort()
		)
		expect(new Set(draft.claims.map(({ claimId }) => claimId)).size).toBe(2)
		expect(new Set(draft.claims.map(({ claimFingerprint }) => claimFingerprint)).size).toBe(2)
	})

	it('retains temporal claims without inferring chronology during base analysis', async () => {
		const analyzer = analyzerFor((content) => ({
			kind: 'development',
			eventTitle: 'Mara opens the gate',
			certainty: 'explicit',
			content,
			entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'related' }]
		}))
		const { operations, inferCampaignImportChronology } = harness(analyzer)
		const draft = await runPromise(
			operations.analyze({
				ingestionId: 'import-temporal',
				campaignId: 'campaign',
				title: 'Temporal lore',
				sources: [source(1, 'Mara Vale opened the western gate.')]
			})
		)

		expect(draft.temporalClaims).toHaveLength(1)
		expect(draft.temporalClaims[0]).toMatchObject({
			kind: 'development',
			eventTitle: 'Mara opens the gate'
		})
		expect(inferCampaignImportChronology).not.toHaveBeenCalled()
		expect(draft).not.toHaveProperty('chronology')
		expect(draft.proposals).toEqual([
			expect.objectContaining({ operation: 'create-event', title: 'Mara opens the gate' })
		])
	})

	it('derives stable claim identities from source revisions and evidence', async () => {
		const analyzer = analyzerFor((content) => ({
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content,
			entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
		}))
		const input = {
			ingestionId: 'stable-import',
			campaignId: 'campaign',
			title: 'Stable lore',
			sources: [source(1, 'Mara Vale carries a blue lantern.')]
		}
		const first = await runPromise(harness(analyzer).operations.analyze(input))
		const second = await runPromise(harness(analyzer).operations.analyze(input))

		expect(second.claims[0]!.claimId).toBe(first.claims[0]!.claimId)
		expect(second.claims[0]!.claimFingerprint).toBe(first.claims[0]!.claimFingerprint)
		expect(second.sources[0]!.sourceId).toBe(first.sources[0]!.sourceId)
		expect(second.sources[0]!.sourceRevisionId).toBe(first.sources[0]!.sourceRevisionId)
	})

	it('assigns distinct stable source identities by slot without using display names', async () => {
		const analyzer = analyzerFor((content) => ({
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content,
			entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
		}))
		const sameNameSources = [
			{ ...source(1, 'First source.'), displayName: 'notes.md' },
			{ ...source(2, 'Second source.'), displayName: 'notes.md' }
		]
		const first = await runPromise(
			harness(analyzer).operations.persistRequest({
				ingestionId: 'stable-source-import',
				campaignId: 'campaign',
				sources: sameNameSources
			})
		)
		const retry = await runPromise(
			harness(analyzer).operations.persistRequest({
				ingestionId: 'stable-source-import',
				campaignId: 'campaign',
				sources: sameNameSources.map((item, index) => ({
					...item,
					displayName: `renamed-${index + 1}.md`
				}))
			})
		)

		expect(first.sources[0]!.sourceId).not.toBe(first.sources[1]!.sourceId)
		expect(retry.sources.map(({ sourceId }) => sourceId)).toEqual(
			first.sources.map(({ sourceId }) => sourceId)
		)
		expect(retry.sources.map(({ sourceRevisionId }) => sourceRevisionId)).toEqual(
			first.sources.map(({ sourceRevisionId }) => sourceRevisionId)
		)
	})

	it('returns the original canonical request when an exact retry arrives later', async () => {
		vi.useFakeTimers()
		try {
			const analyzer = analyzerFor((content) => ({
				kind: 'stable-fact',
				eventTitle: null,
				certainty: 'explicit',
				content,
				entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
			}))
			const { operations } = harness(analyzer)
			const input = {
				ingestionId: 'response-lost-import',
				campaignId: 'campaign',
				sources: [source(1, 'Mara Vale carries a blue lantern.')]
			}

			vi.setSystemTime('2026-09-19T08:00:00.000Z')
			const first = await runPromise(operations.persistRequest(input))
			vi.setSystemTime('2026-09-19T10:00:00.000Z')
			const retry = await runPromise(operations.persistRequest(input))

			expect(retry).toEqual(first)
			expect(retry.createdAt).toBe('2026-09-19T08:00:00.000Z')

			const conflict = await runPromise(
				flip(
					operations.persistRequest({
						...input,
						sources: [{ ...input.sources[0]!, title: 'Changed metadata' }]
					})
				)
			)
			expect(conflict).toMatchObject({
				operation: 'writeCampaignImportData',
				cause: { name: 'ImmutableIngestionConflictError' }
			})
		} finally {
			vi.useRealTimers()
		}
	})

	it('builds one deterministic draft and retries persistence without rebuilding it', async () => {
		const analyzeSessionChunk = vi.fn(
			analyzerFor((content) => ({
				kind: 'stable-fact',
				eventTitle: null,
				certainty: 'explicit',
				content,
				entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
			}))
		)
		const { operations, getDraftWrites } = harness(analyzeSessionChunk, {
			draftWriteFailures: 1
		})
		const request = await runPromise(
			operations.persistRequest({
				ingestionId: 'retry-safe-draft',
				campaignId: 'campaign',
				sources: [
					source(1, 'Mara Vale carries a blue lantern.'),
					source(2, 'Mara Vale knows the eastern road.')
				]
			})
		)
		const analyses = []
		for (const item of request.sources) {
			analyses.push(
				await runPromise(
					operations.analyzePersistedSource(
						request.campaignId,
						request.ingestionId,
						item.sourceRevisionId
					)
				)
			)
		}
		const first = await runPromise(
			operations.buildDraft(request, operations.reconcileAnalyses(analyses))
		)
		const retryBuild = await runPromise(
			operations.buildDraft(request, operations.reconcileAnalyses([...analyses].reverse()))
		)

		expect(first.createdAt).toBe(request.createdAt)
		expect(retryBuild).toEqual(first)
		expect(retryBuild.proposals.map(({ proposalId }) => proposalId)).toEqual(
			first.proposals.map(({ proposalId }) => proposalId)
		)
		expect(getDraftWrites()).toEqual([])

		await expect(runPromise(operations.persistDraft(first))).rejects.toThrow(
			'writeCampaignImportDraft'
		)
		await runPromise(operations.persistDraft(first))

		expect(getDraftWrites()).toEqual([first, first])
		expect(analyzeSessionChunk).toHaveBeenCalledTimes(2)
	})

	it('suppresses already accepted claim fingerprints', async () => {
		const acceptedClaim = {
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit' as const,
			content: 'Mara carries a blue lantern.',
			entityReferences: [{ label: 'Mara Vale', type: 'npc' as const, role: 'subject' as const }]
		}
		const analyzer = analyzerFor(() => acceptedClaim)
		const { operations } = harness(analyzer, {
			acceptedFingerprints: new Set([campaignImportClaimFingerprint(acceptedClaim)])
		})

		const draft = await runPromise(
			operations.analyze({
				ingestionId: 'accepted-claim',
				campaignId: 'campaign',
				title: 'Accepted lore',
				sources: [source(1, acceptedClaim.content)]
			})
		)

		expect(draft.claims).toEqual([])
		expect(draft.proposals).toEqual([])
	})

	it('keeps same-type persisted identities unresolved and unselected', async () => {
		const analyzer = analyzerFor((content) => ({
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content,
			entityReferences: [{ label: 'Mara Vale', type: 'npc', role: 'subject' }]
		}))
		const document = (id: string, type: VaultDocument['type']): VaultDocument => ({
			id,
			path: `${type}/${id}.md`,
			title: 'Mara Vale',
			type,
			aliases: ['The Lantern'],
			after: [],
			during: [],
			summary: '',
			content: '# Mara Vale',
			links: [],
			currentRevisionId: `revision-${id}`
		})
		const { operations, getReview } = harness(analyzer, {
			documents: [document('npc-mara', 'npc'), document('location-mara', 'location')]
		})

		const draft = await runPromise(
			operations.analyze({
				ingestionId: 'conservative-identity',
				campaignId: 'campaign',
				title: 'Identity lore',
				sources: [source(1, 'Mara Vale carries a blue lantern.')]
			})
		)

		expect(draft.proposals[0]).toMatchObject({
			operation: 'create-entity',
			selected: false,
			canCreate: true,
			match: {
				kind: 'unresolved',
				candidates: [expect.objectContaining({ documentId: 'npc-mara' })]
			}
		})
		expect(getReview()).toMatchObject({
			revision: 0,
			selectedProposalIds: [],
			resolutions: [{ proposalId: draft.proposals[0]!.proposalId, kind: 'create' }]
		})
	})

	it('analyzes a single-subject arbitrary source into an unselected inferred proposal', async () => {
		const analyzeSessionChunk = vi.fn(
			analyzerFor(() => ({
				kind: 'stable-fact',
				eventTitle: null,
				certainty: 'inferred',
				content: 'The Shattered Coast is difficult to navigate during storm season.',
				entityReferences: [{ label: 'The Shattered Coast', type: 'location', role: 'subject' }]
			}))
		)
		const { operations, getReview } = harness(analyzeSessionChunk)
		const draft = await runPromise(
			operations.analyze({
				ingestionId: 'single-subject',
				campaignId: 'campaign',
				sources: [
					source(
						1,
						'Travel notes: black waves, broken compasses, and dangerous storms near the coast.'
					)
				]
			})
		)

		expect(analyzeSessionChunk).toHaveBeenCalledOnce()
		expect(draft.claims).toEqual([
			expect.objectContaining({ kind: 'stable-fact', certainty: 'inferred' })
		])
		expect(draft.proposals).toEqual([
			expect.objectContaining({
				claimIds: [draft.claims[0]!.claimId],
				operation: 'create-entity',
				documentType: 'location',
				title: 'The Shattered Coast',
				certainty: 'inferred',
				selected: false
			})
		])
		expect(getReview()?.selectedProposalIds).toEqual([])
	})

	it('retains every proposal when a draft contains more than 500 concepts', async () => {
		const { operations } = harness(
			analyzerFor(() => {
				throw new Error('Source analysis is not used in this test')
			})
		)
		const request = await runPromise(
			operations.persistRequest({
				ingestionId: 'large-draft',
				campaignId: 'campaign',
				sources: [source(1, 'Large import')]
			})
		)
		const [descriptor] = request.sources
		const claims: CampaignImportClaim[] = Array.from({ length: 501 }, (_, index) => ({
			claimId: `claim-${index}`,
			claimFingerprint: `fingerprint-${index}`,
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content: `Entity ${index} knows fact ${index}.`,
			entityReferences: [{ label: `Entity ${index}`, type: 'npc', role: 'subject' }],
			evidence: [
				{
					sourceId: descriptor!.sourceId,
					sourceRevisionId: descriptor!.sourceRevisionId,
					excerpt: `Entity ${index} knows fact ${index}.`,
					chunkId: `chunk-${index}`,
					startStringIndex: index,
					endStringIndex: index + 1,
					startLine: index + 1,
					endLine: index + 1
				}
			]
		}))

		const value = await runPromise(
			operations.buildDraft(
				request,
				operations.reconcileAnalyses([
					{
						sourceId: descriptor!.sourceId,
						sourceRevisionId: descriptor!.sourceRevisionId,
						claims,
						warnings: []
					}
				])
			)
		)

		expect(value.claims).toHaveLength(501)
		expect(value.proposals).toHaveLength(501)
	})
})
