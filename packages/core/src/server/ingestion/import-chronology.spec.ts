import { fail, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../vault/types.js'
import { campaignImportChronology } from './import-chronology.js'
import type {
	CampaignImportChronologyCommitData,
	CampaignImportChronologyCommitPlanData,
	CampaignImportChronologyCompletionData,
	CampaignImportChronologyDraft,
	CampaignImportDraft,
	InferredCampaignImportChronology,
	SessionCommitJournal
} from './types.js'

const campaignId = '40000000-0000-5000-8000-000000000001'
const ingestionId = '30000000-0000-5000-8000-000000000001'
const sourceId = '10000000-0000-5000-8000-000000000001'
const sourceRevisionId = '20000000-0000-5000-8000-000000000001'
const eventOneId = '50000000-0000-5000-8000-000000000001'
const eventTwoId = '50000000-0000-5000-8000-000000000002'

const eventDocument = (id: string, title: string): VaultDocument => ({
	id,
	path: `Events/${title.toLowerCase().replaceAll(' ', '-')}.md`,
	title,
	type: 'event',
	aliases: [],
	after: [],
	during: [],
	eventForm: 'occurrence',
	summary: '',
	content: `# ${title}`,
	links: [],
	currentRevisionId: `revision-${id}`
})

const importDraft: CampaignImportDraft = {
	schemaVersion: 1,
	kind: 'campaign-import',
	campaignId,
	ingestionId,
	createdAt: '2026-09-19T08:00:00.000Z',
	sources: [
		{
			displayName: 'history.md',
			sourceId,
			sourceRevisionId,
			title: 'History',
			mediaType: 'text/markdown',
			contentHash: 'hash',
			byteLength: 40
		}
	],
	claims: [
		{
			claimId: 'claim-1',
			claimFingerprint: 'fingerprint-1',
			kind: 'development',
			eventTitle: 'The gate opens',
			certainty: 'explicit',
			content: 'The gate opens before the coronation.',
			entityReferences: [],
			evidence: [
				{
					sourceId,
					sourceRevisionId,
					excerpt: 'The gate opens before the coronation.',
					chunkId: 'chunk-1',
					startStringIndex: 0,
					endStringIndex: 39,
					startLine: 1,
					endLine: 1
				}
			]
		}
	],
	temporalClaims: [],
	proposals: [
		{
			proposalId: 'proposal-1',
			claimIds: ['claim-1'],
			operation: 'create-event',
			documentType: 'event',
			title: 'The gate opens',
			certainty: 'explicit',
			selected: true,
			evidence: [],
			match: { kind: 'unresolved', candidates: [] },
			references: [],
			content: 'The gate opens before the coronation.',
			canCreate: true
		}
	],
	warnings: []
}
importDraft.temporalClaims = importDraft.claims

const chronologyHarness = ({
	draft = structuredClone(importDraft),
	journal,
	documents,
	inference,
	draftWriteFailures = 0
}: {
	draft?: CampaignImportDraft
	journal: SessionCommitJournal
	documents: VaultDocument[]
	inference: InferredCampaignImportChronology
	draftWriteFailures?: number
}) => {
	let saved: CampaignImportChronologyDraft | undefined
	let commitData: CampaignImportChronologyCommitData | undefined
	let commitPlan: CampaignImportChronologyCommitPlanData | undefined
	let completion: CampaignImportChronologyCompletionData | undefined
	let savedJournal = structuredClone(journal)
	const draftWrites: CampaignImportChronologyDraft[] = []
	let remainingDraftWriteFailures = draftWriteFailures
	const inferCampaignImportChronology = vi.fn(() => succeed(inference))
	const recordChronologyProvenance = vi.fn(() => succeed(undefined))
	const updateDocument = vi.fn(
		(
			_campaignId: string,
			documentId: string,
			input: { after?: string[]; during?: string[]; eventForm?: VaultDocument['eventForm'] }
		) => {
			const current = documents.find(({ id }) => id === documentId)!
			return succeed({
				...current,
				after: input.after ?? current.after,
				during: input.during ?? current.during,
				eventForm: input.eventForm,
				currentRevisionId: `updated-${documentId}`
			})
		}
	)
	const operations = campaignImportChronology({
		ai: { analysisModel: 'analysis-model', inferCampaignImportChronology },
		history: {
			getAcceptedClaimFingerprints: () => succeed(new Set()),
			recordProvenance: () => succeed(undefined),
			recordChronologyProvenance,
			persistSourceRevisions: () => succeed(undefined),
			verifyPermanence: () => succeed(undefined),
			verifyChronologyPermanence: () => succeed(undefined)
		},
		storage: {
			readCampaignImportDraft: () => succeed(draft),
			readCampaignImportCompletion: () =>
				succeed({
					schemaVersion: 1,
					kind: 'campaign-import-completion',
					campaignId,
					ingestionId,
					documents: [],
					finalized: true
				}),
			readCommitJournal: () => succeed(savedJournal),
			writeCommitJournal: (next) => {
				savedJournal = structuredClone(next)
				return succeed(undefined)
			},
			writeCampaignImportChronologyDraft: (next) => {
				saved = structuredClone(next)
				draftWrites.push(structuredClone(next))
				if (remainingDraftWriteFailures > 0) {
					remainingDraftWriteFailures -= 1
					return fail({
						domain: 'ingestionStorage' as const,
						operation: 'writeCampaignImportChronologyDraft' as const,
						cause: { reason: 'simulatedPostWriteFailure' }
					})
				}
				return succeed(undefined)
			},
			readCampaignImportChronologyDraft: () => succeed(saved!),
			writeCampaignImportChronologyCommitData: (next) => {
				commitData = structuredClone(next)
				return succeed(undefined)
			},
			readCampaignImportChronologyCommitData: () => succeed(commitData!),
			writeCampaignImportChronologyCommitPlan: (next) => {
				commitPlan = structuredClone(next)
				return succeed(undefined)
			},
			readCampaignImportChronologyCommitPlan: () => succeed(commitPlan),
			writeCampaignImportChronologyCompletion: (next) => {
				completion = structuredClone(next)
				return succeed(undefined)
			},
			readCampaignImportChronologyCompletion: () => succeed(completion)
		},
		vault: {
			getDocuments: () => succeed(documents),
			createDocument: () => succeed({} as never),
			updateDocument
		}
	})
	return {
		operations,
		inferCampaignImportChronology,
		getSaved: () => saved,
		getCompletion: () => completion,
		getDraftWrites: () => draftWrites,
		recordChronologyProvenance,
		updateDocument,
		getJournal: () => savedJournal
	}
}

describe('campaign import chronology', () => {
	it('retries persistence with the exact built draft without invoking inference again', async () => {
		const harness = chronologyHarness({
			journal: {
				schemaVersion: 1,
				campaignId,
				ingestionId,
				applied: {
					'event-mutation': {
						mutationId: 'event-mutation',
						proposalId: 'proposal-1',
						documentId: eventOneId,
						documentType: 'event',
						revisionId: 'event-revision'
					}
				}
			},
			documents: [
				eventDocument(eventOneId, 'The gate opens'),
				eventDocument(eventTwoId, 'The coronation')
			],
			inference: {
				relations: [],
				coverage: [
					{
						eventId: eventOneId,
						status: 'intentionally-unplaced',
						reason: 'The accepted evidence does not establish relative order.'
					}
				]
			},
			draftWriteFailures: 1
		})

		const built = await runPromise(harness.operations.buildDraft(campaignId, ingestionId))

		expect(built.draft.createdAt).toBe(importDraft.createdAt)
		expect(harness.getDraftWrites()).toEqual([])
		expect(harness.inferCampaignImportChronology).toHaveBeenCalledOnce()

		await expect(runPromise(harness.operations.persistDraft(built))).rejects.toThrow(
			'writeCampaignImportChronologyDraft'
		)
		await runPromise(harness.operations.persistDraft(built))

		expect(harness.getDraftWrites()).toEqual([built.draft, built.draft])
		expect(harness.getSaved()).toEqual(built.draft)
		expect(harness.inferCampaignImportChronology).toHaveBeenCalledOnce()
	})

	it('uses accepted claim evidence and final event IDs without source extraction', async () => {
		let chronologyDraft: CampaignImportChronologyDraft | undefined
		let commitData: CampaignImportChronologyCommitData | undefined
		let commitPlan: CampaignImportChronologyCommitPlanData | undefined
		let chronologyCompletion: CampaignImportChronologyCompletionData | undefined
		let journal: SessionCommitJournal = {
			schemaVersion: 1,
			campaignId,
			ingestionId,
			applied: {
				'base-mutation': {
					mutationId: 'base-mutation',
					proposalId: 'proposal-1',
					documentId: eventOneId,
					documentType: 'event',
					revisionId: 'base-revision'
				}
			}
		}
		const documents = [
			eventDocument(eventOneId, 'The gate opens'),
			eventDocument(eventTwoId, 'The coronation')
		]
		const inferCampaignImportChronology = vi.fn(
			({ prompt, system }: { prompt: string; system?: string }) => {
				expect(prompt).toContain('The gate opens before the coronation.')
				expect(prompt).toContain('Accepted imported temporal claims')
				expect(prompt).toContain(eventOneId)
				expect(prompt).not.toContain('"eventId": "proposal-1"')
				expect(prompt).toContain(sourceId)
				expect(prompt).toContain(sourceRevisionId)
				expect(prompt).not.toContain('ARBITRARY NON-TEMPORAL SOURCE TEXT')
				expect(system).toContain('upload order')
				expect(system).toContain('source order')
				expect(system).toContain('document order')
				expect(system).toContain('array order')
				expect(system).toContain('line order across different sources')
				expect(system).toContain('Unknown order is valid')
				expect(system).not.toContain('new session events')
				expect(system).not.toContain('full session transcript')
				return succeed({
					relations: [
						{
							relation: 'before' as const,
							sourceEventId: eventOneId,
							targetEventId: eventTwoId,
							certainty: 'explicit' as const,
							reason: 'The accepted evidence states the order.',
							claimIds: ['claim-1']
						}
					],
					coverage: [
						{
							eventId: eventOneId,
							status: 'connected' as const,
							reason: 'Placed before the coronation.'
						}
					]
				})
			}
		)
		const analyzeSessionChunk = vi.fn()
		const recordChronologyProvenance = vi.fn(() => succeed(undefined))
		const updateDocument = vi.fn(
			(
				_campaignId: string,
				documentId: string,
				input: {
					after?: string[]
					revision?: { changeSummary: string; relatedSessionId?: string }
				}
			) => {
				const current = documents.find(({ id }) => id === documentId)!
				return succeed({
					...current,
					after: input.after ?? [],
					currentRevisionId: `updated-${documentId}`
				})
			}
		)
		const ai = {
			analysisModel: 'analysis-model',
			inferCampaignImportChronology,
			analyzeSessionChunk
		}
		const operations = campaignImportChronology({
			ai,
			history: {
				getAcceptedClaimFingerprints: () => succeed(new Set()),
				recordProvenance: () => succeed(undefined),
				recordChronologyProvenance,
				persistSourceRevisions: () => succeed(undefined),
				verifyPermanence: () => succeed(undefined),
				verifyChronologyPermanence: () => succeed(undefined)
			},
			storage: {
				readCampaignImportDraft: () => succeed(importDraft),
				readCampaignImportCompletion: () =>
					succeed({
						schemaVersion: 1,
						kind: 'campaign-import-completion',
						campaignId,
						ingestionId,
						documents: [
							{
								proposalId: 'proposal-1',
								documentId: eventOneId,
								documentType: 'event'
							}
						],
						finalized: true
					}),
				readCommitJournal: () => succeed(journal),
				writeCommitJournal: (next) => {
					journal = structuredClone(next)
					return succeed(undefined)
				},
				writeCampaignImportChronologyDraft: (next) => {
					chronologyDraft = structuredClone(next)
					return succeed(undefined)
				},
				readCampaignImportChronologyDraft: () => succeed(chronologyDraft!),
				writeCampaignImportChronologyCommitData: (next) => {
					commitData = structuredClone(next)
					return succeed(undefined)
				},
				readCampaignImportChronologyCommitData: () => succeed(commitData!),
				writeCampaignImportChronologyCommitPlan: (next) => {
					commitPlan = structuredClone(next)
					return succeed(undefined)
				},
				readCampaignImportChronologyCommitPlan: () => succeed(commitPlan),
				writeCampaignImportChronologyCompletion: (next) => {
					chronologyCompletion = structuredClone(next)
					return succeed(undefined)
				},
				readCampaignImportChronologyCompletion: () => succeed(chronologyCompletion)
			},
			vault: {
				getDocuments: () => succeed(documents),
				createDocument: () => succeed({} as never),
				updateDocument
			}
		})

		const analysis = await runPromise(operations.analyze(campaignId, ingestionId))
		expect(inferCampaignImportChronology).toHaveBeenCalledOnce()
		expect(analyzeSessionChunk).not.toHaveBeenCalled()
		expect(analysis.createdAt).toBe(importDraft.createdAt)
		expect(analysis.chronology).toEqual([
			expect.objectContaining({
				supportingClaimIds: ['claim-1'],
				source: expect.objectContaining({ eventId: eventOneId, source: 'existing' }),
				target: expect.objectContaining({ eventId: eventTwoId, source: 'existing' }),
				selected: true,
				evidence: [
					expect.objectContaining({
						sourceId,
						sourceRevisionId,
						chunkId: 'chunk-1',
						startStringIndex: 0,
						endStringIndex: 39,
						startLine: 1,
						endLine: 1,
						excerpt: 'The gate opens before the coronation.'
					})
				]
			})
		])

		const result = await runPromise(
			operations.commit({
				campaignId,
				ingestionId,
				selectedChronologyIds: [analysis.chronology[0]!.chronologyId]
			})
		)
		expect(result).toMatchObject({ updatedDocumentIds: [eventTwoId], finalized: true })
		expect(updateDocument).toHaveBeenCalledOnce()
		expect(updateDocument).toHaveBeenCalledWith(
			campaignId,
			eventTwoId,
			expect.objectContaining({ after: [eventOneId] })
		)
		const revision = updateDocument.mock.calls[0]![2].revision
		expect(revision).toMatchObject({
			changeSummary: 'Updated chronology from campaign import'
		})
		expect(revision).not.toHaveProperty('relatedSessionId')
		expect(recordChronologyProvenance).toHaveBeenCalledWith(campaignId, ingestionId, [
			expect.objectContaining({
				chronologyId: analysis.chronology[0]!.chronologyId,
				relation: 'before',
				sourceEventId: eventOneId,
				targetEventId: eventTwoId,
				affectedDocumentId: eventTwoId,
				vaultRevisionId: `updated-${eventTwoId}`,
				claim: expect.objectContaining({
					claimId: 'claim-1',
					claimFingerprint: 'fingerprint-1'
				}),
				source: expect.objectContaining({ sourceId, sourceRevisionId }),
				evidence: expect.objectContaining({
					excerpt: 'The gate opens before the coronation.',
					startStringIndex: 0,
					endStringIndex: 39,
					startLine: 1,
					endLine: 1
				})
			})
		])
	})

	it('retries a partial during commit and records both resulting revisions idempotently', async () => {
		const harness = chronologyHarness({
			journal: {
				schemaVersion: 1,
				campaignId,
				ingestionId,
				applied: {
					'base-mutation': {
						mutationId: 'base-mutation',
						proposalId: 'proposal-1',
						documentId: eventOneId,
						documentType: 'event',
						revisionId: 'base-revision'
					}
				}
			},
			documents: [
				eventDocument(eventOneId, 'The gate opens'),
				eventDocument(eventTwoId, 'The coronation')
			],
			inference: {
				relations: [
					{
						relation: 'during',
						sourceEventId: eventOneId,
						targetEventId: eventTwoId,
						certainty: 'explicit',
						reason: 'The accepted evidence establishes containment.',
						claimIds: ['claim-1']
					}
				],
				coverage: [
					{
						eventId: eventOneId,
						status: 'connected',
						reason: 'Placed during the coronation.'
					}
				]
			}
		})
		const analysis = await runPromise(harness.operations.analyze(campaignId, ingestionId))
		const originalUpdate = harness.updateDocument.getMockImplementation()!
		let targetFailures = 1
		harness.updateDocument.mockImplementation((...args) => {
			if (args[1] === eventTwoId && targetFailures > 0) {
				targetFailures -= 1
				return fail({
					domain: 'vaultRevision' as const,
					operation: 'verifyBase' as const,
					cause: { reason: 'simulatedPartialFailure' }
				})
			}
			return originalUpdate(...args)
		})
		const input = {
			campaignId,
			ingestionId,
			selectedChronologyIds: [analysis.chronology[0]!.chronologyId]
		}

		await expect(runPromise(harness.operations.commit(input))).rejects.toThrow()
		const sourceMutation = Object.values(harness.getJournal().applied).find(
			(result) => result.documentId === eventOneId && !result.proposalId
		)
		expect(sourceMutation).toMatchObject({ revisionId: `updated-${eventOneId}` })

		await expect(runPromise(harness.operations.commit(input))).resolves.toMatchObject({
			updatedDocumentIds: [eventOneId, eventTwoId],
			finalized: true
		})
		expect(harness.updateDocument.mock.calls.filter(([, id]) => id === eventOneId)).toHaveLength(1)
		expect(harness.updateDocument.mock.calls.filter(([, id]) => id === eventTwoId)).toHaveLength(2)
		expect(harness.recordChronologyProvenance).toHaveBeenCalledOnce()
		expect(
			harness.recordChronologyProvenance.mock.calls[0]![2].map(
				(record: { affectedDocumentId: string; vaultRevisionId: string }) => [
					record.affectedDocumentId,
					record.vaultRevisionId
				]
			)
		).toEqual([
			[eventOneId, `updated-${eventOneId}`],
			[eventTwoId, `updated-${eventTwoId}`]
		])

		await runPromise(harness.operations.commit(input))
		expect(harness.recordChronologyProvenance).toHaveBeenCalledOnce()
	})

	it('excludes unapplied and non-event claims and rejects existing-only edges', async () => {
		const draft = structuredClone(importDraft)
		const rejectedClaim = {
			...structuredClone(draft.claims[0]!),
			claimId: 'claim-rejected',
			claimFingerprint: 'fingerprint-rejected',
			eventTitle: 'Rejected event',
			content: 'REJECTED EVENT CLAIM'
		}
		const nonEventClaim = {
			...structuredClone(draft.claims[0]!),
			claimId: 'claim-non-event',
			claimFingerprint: 'fingerprint-non-event',
			eventTitle: 'Misrouted event',
			content: 'NON-EVENT APPLIED CLAIM'
		}
		draft.claims.push(rejectedClaim, nonEventClaim)
		draft.temporalClaims.push(rejectedClaim, nonEventClaim)
		draft.proposals.push(
			{
				...structuredClone(draft.proposals[0]!),
				proposalId: 'proposal-rejected',
				claimIds: [rejectedClaim.claimId],
				title: 'Rejected event',
				content: rejectedClaim.content
			},
			{
				...structuredClone(draft.proposals[0]!),
				proposalId: 'proposal-non-event',
				claimIds: [nonEventClaim.claimId],
				operation: 'create-entity',
				documentType: 'npc',
				title: 'Non-event owner',
				content: nonEventClaim.content
			}
		)
		const journal: SessionCommitJournal = {
			schemaVersion: 1,
			campaignId,
			ingestionId,
			applied: {
				'event-mutation': {
					mutationId: 'event-mutation',
					proposalId: 'proposal-1',
					documentId: eventOneId,
					documentType: 'event',
					revisionId: 'event-revision'
				},
				'entity-mutation': {
					mutationId: 'entity-mutation',
					proposalId: 'proposal-non-event',
					documentId: 'npc-document',
					documentType: 'npc',
					revisionId: 'npc-revision'
				}
			}
		}
		const existingOneId = '50000000-0000-5000-8000-000000000003'
		const inference: InferredCampaignImportChronology = {
			relations: [
				{
					relation: 'before',
					sourceEventId: eventOneId,
					targetEventId: eventTwoId,
					certainty: 'inferred',
					reason: 'Supported by the accepted claim.',
					claimIds: ['claim-1']
				},
				{
					relation: 'before',
					sourceEventId: eventTwoId,
					targetEventId: existingOneId,
					certainty: 'explicit',
					reason: 'Attempts to reorder existing history.',
					claimIds: ['claim-1']
				}
			],
			coverage: [
				{
					eventId: eventOneId,
					status: 'connected',
					reason: 'Connected to an existing anchor.'
				}
			]
		}
		const harness = chronologyHarness({
			draft,
			journal,
			documents: [
				eventDocument(eventOneId, 'The gate opens'),
				eventDocument(eventTwoId, 'The coronation'),
				eventDocument(existingOneId, 'The aftermath')
			],
			inference
		})

		const analysis = await runPromise(harness.operations.analyze(campaignId, ingestionId))
		const [{ prompt }] = harness.inferCampaignImportChronology.mock.calls[0]!

		expect(prompt).toContain(eventOneId)
		expect(prompt).not.toContain('"eventId": "proposal-1"')
		expect(prompt).not.toContain(rejectedClaim.content)
		expect(prompt).not.toContain(nonEventClaim.content)
		expect(analysis.chronology).toHaveLength(1)
		expect(analysis.chronology[0]).toMatchObject({
			selected: false,
			source: { eventId: eventOneId },
			target: { eventId: eventTwoId },
			evidence: [expect.objectContaining({ sourceId, sourceRevisionId, chunkId: 'chunk-1' })]
		})
		expect(
			analysis.chronology.every(
				({ source, target }) => source.eventId === eventOneId || target.eventId === eventOneId
			)
		).toBe(true)
		expect(analysis.warnings.some((warning) => warning.includes('[invalid-reference]'))).toBe(true)
		expect(harness.getSaved()).toEqual(analysis)
	})

	it('skips inference without applied imported events or two usable total events', async () => {
		const withoutApplied = chronologyHarness({
			journal: { schemaVersion: 1, campaignId, ingestionId, applied: {} },
			documents: [
				eventDocument(eventOneId, 'Existing one'),
				eventDocument(eventTwoId, 'Existing two')
			],
			inference: { relations: [], coverage: [] }
		})
		const noAppliedBuilt = await runPromise(
			withoutApplied.operations.buildDraft(campaignId, ingestionId)
		)
		expect(withoutApplied.getSaved()).toBeUndefined()
		expect(withoutApplied.getCompletion()).toBeUndefined()
		await runPromise(withoutApplied.operations.persistDraft(noAppliedBuilt))
		const noAppliedResult = noAppliedBuilt.draft
		expect(withoutApplied.inferCampaignImportChronology).not.toHaveBeenCalled()
		expect(noAppliedResult.chronology).toEqual([])
		expect(noAppliedResult.chronologyCoverage).toEqual([])
		expect(withoutApplied.getCompletion()).toMatchObject({
			kind: 'campaign-import-chronology-no-relations',
			updatedDocumentIds: [],
			finalized: true
		})

		const oneApplied = chronologyHarness({
			journal: {
				schemaVersion: 1,
				campaignId,
				ingestionId,
				applied: {
					'event-mutation': {
						mutationId: 'event-mutation',
						proposalId: 'proposal-1',
						documentId: eventOneId,
						documentType: 'event',
						revisionId: 'event-revision'
					}
				}
			},
			documents: [eventDocument(eventOneId, 'The gate opens')],
			inference: { relations: [], coverage: [] }
		})
		const oneEventResult = await runPromise(oneApplied.operations.analyze(campaignId, ingestionId))
		expect(oneApplied.inferCampaignImportChronology).not.toHaveBeenCalled()
		expect(oneEventResult.chronologyCoverage).toEqual([
			expect.objectContaining({
				event: expect.objectContaining({ eventId: eventOneId }),
				status: 'intentionally-unplaced'
			})
		])
		expect(oneApplied.getCompletion()).toMatchObject({
			kind: 'campaign-import-chronology-no-relations',
			updatedDocumentIds: []
		})
	})

	it('accepts unknown placement and drops relations with unsupported evidence', async () => {
		const journal: SessionCommitJournal = {
			schemaVersion: 1,
			campaignId,
			ingestionId,
			applied: {
				'event-mutation': {
					mutationId: 'event-mutation',
					proposalId: 'proposal-1',
					documentId: eventOneId,
					documentType: 'event',
					revisionId: 'event-revision'
				}
			}
		}
		const unknown = chronologyHarness({
			journal,
			documents: [
				eventDocument(eventOneId, 'The gate opens'),
				eventDocument(eventTwoId, 'The coronation')
			],
			inference: {
				relations: [],
				coverage: [
					{
						eventId: eventOneId,
						status: 'intentionally-unplaced',
						reason: 'The accepted evidence does not establish relative order.'
					}
				]
			}
		})
		const unknownResult = await runPromise(unknown.operations.analyze(campaignId, ingestionId))
		expect(unknownResult.chronology).toEqual([])
		expect(unknownResult.chronologyCoverage[0]).toMatchObject({
			status: 'intentionally-unplaced'
		})
		expect(unknownResult.warnings).toEqual([])

		const unsupported = chronologyHarness({
			journal,
			documents: [
				eventDocument(eventOneId, 'The gate opens'),
				eventDocument(eventTwoId, 'The coronation')
			],
			inference: {
				relations: [
					{
						relation: 'before',
						sourceEventId: eventOneId,
						targetEventId: eventTwoId,
						certainty: 'explicit',
						reason: 'No accepted claim supports this.',
						claimIds: ['unknown-claim']
					},
					{
						relation: 'during',
						sourceEventId: eventOneId,
						targetEventId: eventTwoId,
						certainty: 'inferred',
						reason: 'No evidence was supplied.',
						claimIds: []
					}
				],
				coverage: [
					{
						eventId: eventOneId,
						status: 'intentionally-unplaced',
						reason: 'Unsupported relationships were omitted.'
					}
				]
			}
		})
		const unsupportedResult = await runPromise(
			unsupported.operations.analyze(campaignId, ingestionId)
		)
		expect(unsupportedResult.chronology).toEqual([])
		expect(unsupportedResult.warnings).toEqual([
			expect.stringContaining('[unsupported-evidence]'),
			expect.stringContaining('[missing-evidence]')
		])
	})
})
