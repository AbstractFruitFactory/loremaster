import { fail, flip, gen, runPromise, succeed, type Effect } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../vault/types.js'
import type { Failure } from '../failure.js'
import { campaignImportCommit } from './import-commit.js'
import { campaignImportLifecycle } from './import-lifecycle.js'
import type {
	CampaignImportClaim,
	CampaignImportChronologyCommitPlanData,
	CampaignImportCommitData,
	CampaignImportCommitInput,
	CampaignImportCommitPlanData,
	CampaignImportCompletionData,
	CampaignImportDraft,
	CampaignImportSource,
	SessionCommitJournal,
	SessionProposal
} from './types.js'

const runStagedCommit = (
	operations: ReturnType<typeof campaignImportCommit>,
	input: CampaignImportCommitInput
): Effect<CampaignImportCompletionData, Failure> =>
	gen(function* () {
		const data = yield* operations.persistCommitData(input)
		const prepared = yield* operations.planCommit(data)
		for (const mutationId of operations.commitMutationIds(prepared)) {
			yield* operations.applyCommitMutation(data, prepared, mutationId)
		}
		return yield* operations.finalizeCommit(data, prepared)
	})

const source: CampaignImportSource = {
	displayName: 'lore/mara.md',
	sourceId: '10000000-0000-5000-8000-000000000001',
	sourceRevisionId: '20000000-0000-5000-8000-000000000001',
	title: 'Mara',
	mediaType: 'text/markdown',
	contentHash: 'hash',
	byteLength: 100
}

const claim = (index: number): CampaignImportClaim => ({
	claimId: `claim-${index}`,
	claimFingerprint: `fingerprint-${index}`,
	kind: 'stable-fact',
	eventTitle: null,
	certainty: 'explicit',
	content: `Claim ${index}`,
	entityReferences: [{ label: `Entity ${index}`, type: 'npc', role: 'subject' }],
	evidence: [
		{
			sourceId: source.sourceId,
			sourceRevisionId: source.sourceRevisionId,
			excerpt: `Claim ${index}`,
			chunkId: 'chunk',
			startStringIndex: index,
			endStringIndex: index + 1,
			startLine: index,
			endLine: index
		}
	]
})

const proposal = (index: number, overrides: Partial<SessionProposal> = {}): SessionProposal => ({
	proposalId: `proposal-${index}`,
	claimIds: [`claim-${index}`],
	operation: 'create-entity',
	documentType: 'npc',
	title: `Entity ${index}`,
	certainty: 'explicit',
	selected: true,
	evidence: claim(index).evidence,
	match: { kind: 'unresolved', candidates: [] },
	references: [],
	content: `Claim ${index}`,
	canCreate: true,
	...overrides
})

const draft = (proposals: SessionProposal[]): CampaignImportDraft => ({
	schemaVersion: 1,
	kind: 'campaign-import',
	ingestionId: '30000000-0000-5000-8000-000000000001',
	campaignId: '40000000-0000-5000-8000-000000000001',
	createdAt: '2026-09-19T08:00:00.000Z',
	sources: [source],
	claims: proposals.map((_, index) => claim(index + 1)),
	temporalClaims: [],
	proposals,
	warnings: []
})

const existing: VaultDocument = {
	id: 'existing-mara',
	path: 'NPCs/mara.md',
	title: 'Mara',
	type: 'npc',
	aliases: [],
	after: [],
	during: [],
	summary: '',
	content: '# Mara',
	links: [],
	currentRevisionId: 'existing-revision'
}

const setup = (value: CampaignImportDraft) => {
	let journal: SessionCommitJournal | undefined
	let commitData: CampaignImportCommitData | undefined
	let commitPlan: CampaignImportCommitPlanData | undefined
	let completion: CampaignImportCompletionData | undefined
	const documents = [existing]
	const createDocument = vi.fn(
		(
			_campaignId: string,
			input: {
				documentId?: string
				path: string
				type: VaultDocument['type']
				after?: string[]
				during?: string[]
				content: string
				revision?: { revisionId: string; changeSummary: string }
			}
		) => {
			const created = {
				id: input.documentId!,
				path: input.path,
				title: input.content.match(/^# (.+)$/m)?.[1] ?? input.path,
				type: input.type,
				aliases: [],
				after: input.after ?? [],
				during: input.during ?? [],
				summary: '',
				content: input.content,
				links: [],
				currentRevisionId: input.revision!.revisionId
			} satisfies VaultDocument
			documents.push(created)
			return succeed(created)
		}
	)
	const updateDocument = vi.fn(() => succeed(existing))
	const persisted = new Set<string>()
	const recordProvenance = vi.fn(
		(_campaignId: string, _ingestionId: string, records: { claim: CampaignImportClaim }[]) => {
			for (const record of records) persisted.add(record.claim.claimFingerprint)
			return succeed(undefined)
		}
	)
	const persistSourceRevisions = vi.fn(() => succeed(undefined))
	const verifyPermanence = vi.fn(() => succeed(undefined))
	const verifyChronologyPermanence = vi.fn(() => succeed(undefined))
	const readLifecycleState = vi.fn(() => succeed({} as never))
	const readChronologyPlan = vi.fn(() => succeed(undefined))
	const verifySourceBodies = vi.fn(() => succeed(undefined))
	const cleanupCampaignImport = vi.fn(() => succeed(undefined))
	let cleanupVerified = false
	let cleanupStarted = false
	const markCleanupStarted = vi.fn(() => {
		cleanupStarted = true
		return succeed(undefined)
	})
	const history = {
		getAcceptedClaimFingerprints: () => succeed(new Set()),
		recordProvenance,
		recordChronologyProvenance: () => succeed(undefined),
		persistSourceRevisions,
		verifyPermanence,
		verifyChronologyPermanence
	}
	const storage = {
		readCampaignImportDraft: () => succeed(value),
		writeCampaignImportCommitData: (next: CampaignImportCommitData) => {
			commitData = structuredClone(next)
			return succeed(undefined)
		},
		readCampaignImportCommitData: () => succeed(commitData!),
		writeCampaignImportCommitPlan: (next: CampaignImportCommitPlanData) => {
			commitPlan = structuredClone(next)
			return succeed(undefined)
		},
		readCampaignImportCommitPlan: () => succeed(commitPlan),
		writeCampaignImportCompletion: (next: CampaignImportCompletionData) => {
			completion = structuredClone(next)
			return succeed(undefined)
		},
		readCampaignImportCompletion: () => succeed(completion),
		readCommitJournal: () => succeed(journal),
		writeCommitJournal: (next: SessionCommitJournal) => {
			journal = structuredClone(next)
			return succeed(undefined)
		},
		verifyCampaignImportSourceBodies: verifySourceBodies,
		isCampaignImportCleanupVerified: () => succeed(cleanupVerified),
		isCampaignImportCleanupStarted: () => succeed(cleanupStarted),
		markCampaignImportCleanupStarted: markCleanupStarted,
		markCampaignImportCleanupVerified: () => {
			cleanupVerified = true
			return succeed(undefined)
		},
		acquireCampaignImportOperationLease: () => succeed({ ownerToken: 'test-owner' }),
		releaseCampaignImportOperationLease: () => succeed(undefined),
		cleanupCampaignImport,
		writeCampaignImportChronologyDispatch: () => succeed(undefined),
		readCampaignImportChronologyDispatch: () => succeed(undefined),
		writeCampaignImportChronologyDraft: () => succeed(undefined),
		readCampaignImportChronologyDraft: () => succeed({} as never),
		writeCampaignImportChronologyCommitData: () => succeed(undefined),
		readCampaignImportChronologyCommitData: () => succeed({} as never),
		writeCampaignImportChronologyCommitPlan: () => succeed(undefined),
		readCampaignImportChronologyCommitPlan: readChronologyPlan,
		writeCampaignImportChronologyCompletion: () => succeed(undefined),
		readCampaignImportChronologyCompletion: () => succeed(undefined),
		listCampaignImports: () => succeed([]),
		discardCampaignImport: () => succeed(undefined),
		readCampaignImportLifecycleState: readLifecycleState
	}
	const operations = {
		...campaignImportCommit({
			history,
			storage,
			vault: {
				getDocuments: () => succeed(documents),
				createDocument,
				updateDocument
			}
		}),
		...campaignImportLifecycle({ history, storage })
	}
	return {
		operations,
		createDocument,
		updateDocument,
		recordProvenance,
		persistSourceRevisions,
		verifyPermanence,
		verifyChronologyPermanence,
		readLifecycleState,
		readChronologyPlan,
		setJournal: (next: SessionCommitJournal) => {
			journal = structuredClone(next)
		},
		verifySourceBodies,
		cleanupCampaignImport,
		markCleanupStarted,
		persisted
	}
}

describe('campaign import commit', () => {
	it('creates for an explicit create resolution and commits selected proposals idempotently', async () => {
		const ambiguous = proposal(1, {
			title: 'Mara',
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: existing.id,
						revisionId: existing.currentRevisionId!,
						title: existing.title,
						documentType: existing.type,
						score: 3
					}
				]
			}
		})
		const selected = proposal(2)
		const unselected = proposal(3)
		const harness = setup(draft([ambiguous, selected, unselected]))
		const input = {
			campaignId: '40000000-0000-5000-8000-000000000001',
			ingestionId: '30000000-0000-5000-8000-000000000001',
			expectedReviewRevision: 0,
			selectedProposalIds: [ambiguous.proposalId, selected.proposalId],
			resolutions: [{ proposalId: ambiguous.proposalId, kind: 'create' as const }]
		}

		const first = await runPromise(runStagedCommit(harness.operations, input))
		const second = await runPromise(runStagedCommit(harness.operations, input))

		expect(first.finalized).toBe(true)
		expect(second).toEqual(first)
		expect(first.documents.map(({ proposalId }) => proposalId)).toEqual([
			ambiguous.proposalId,
			selected.proposalId
		])
		expect(harness.createDocument).toHaveBeenCalledTimes(2)
		expect(harness.createDocument).toHaveBeenCalledWith(
			input.campaignId,
			expect.objectContaining({
				revision: expect.objectContaining({ changeSummary: 'Applied from campaign import' })
			})
		)
		expect(harness.updateDocument).not.toHaveBeenCalled()
		expect(harness.persisted).toEqual(new Set(['fingerprint-1', 'fingerprint-2']))
		expect(harness.recordProvenance).toHaveBeenCalledTimes(4)
		expect(harness.persistSourceRevisions).toHaveBeenCalledTimes(1)
	})

	it('rejects a selected unresolved identity without a resolution', async () => {
		const ambiguous = proposal(1, {
			match: {
				kind: 'unresolved',
				candidates: [
					{
						documentId: existing.id,
						revisionId: existing.currentRevisionId!,
						title: existing.title,
						documentType: existing.type,
						score: 3
					}
				]
			}
		})
		const value = draft([ambiguous])
		const harness = setup(value)

		expect(
			await runPromise(
				flip(
					runStagedCommit(harness.operations, {
						campaignId: value.campaignId,
						ingestionId: value.ingestionId,
						expectedReviewRevision: 0,
						selectedProposalIds: [ambiguous.proposalId]
					})
				)
			)
		).toMatchObject({
			domain: 'ingestion',
			operation: 'commit',
			cause: { reason: 'unresolvedMatch', proposalId: ambiguous.proposalId }
		})
	})

	it('rejects commits with more than 500 selected proposals before persistence', async () => {
		const proposals = Array.from({ length: 501 }, (_, index) => proposal(index))
		const value = draft(proposals)
		const harness = setup(value)

		expect(
			await runPromise(
				flip(
					harness.operations.persistCommitData({
						campaignId: value.campaignId,
						ingestionId: value.ingestionId,
						expectedReviewRevision: 0,
						selectedProposalIds: proposals.map(({ proposalId }) => proposalId)
					})
				)
			)
		).toMatchObject({
			domain: 'ingestion',
			operation: 'commit',
			cause: { reason: 'selectionLimitExceeded', maximum: 500, selectedProposalCount: 501 }
		})
		expect(harness.createDocument).not.toHaveBeenCalled()
	})

	it('persists immutable source revisions after a selective import', async () => {
		const accepted = proposal(1)
		const rejected = proposal(2)
		const value = draft([accepted, rejected])
		const harness = setup(value)

		const result = await runPromise(
			runStagedCommit(harness.operations, {
				campaignId: value.campaignId,
				ingestionId: value.ingestionId,
				expectedReviewRevision: 0,
				selectedProposalIds: [accepted.proposalId]
			})
		)

		expect(result.finalized).toBe(true)
		expect(result.documents).toHaveLength(1)
		expect(harness.persisted).toEqual(new Set(['fingerprint-1']))
		expect(harness.persistSourceRevisions).toHaveBeenCalledWith(
			value.campaignId,
			value.ingestionId,
			[source]
		)
	})

	it('persists a plan, applies one deterministic mutation at a time, and finalizes no-change imports', async () => {
		const accepted = proposal(1)
		const value = draft([accepted])
		const harness = setup(value)
		const data = await runPromise(
			harness.operations.persistCommitData({
				campaignId: value.campaignId,
				ingestionId: value.ingestionId,
				expectedReviewRevision: 0,
				selectedProposalIds: [accepted.proposalId]
			})
		)
		const prepared = await runPromise(harness.operations.planCommit(data))
		const [mutationId] = harness.operations.commitMutationIds(prepared)

		expect(mutationId).toMatch(/^[\da-f-]{36}$/)
		await runPromise(harness.operations.applyCommitMutation(data, prepared, mutationId!))
		const completion = await runPromise(harness.operations.finalizeCommit(data, prepared))
		expect(completion.documents).toHaveLength(1)
		expect(harness.createDocument).toHaveBeenCalledOnce()

		const noChangeValue = draft([])
		const noChangeHarness = setup(noChangeValue)
		const noChange = await runPromise(
			runStagedCommit(noChangeHarness.operations, {
				campaignId: noChangeValue.campaignId,
				ingestionId: noChangeValue.ingestionId,
				expectedReviewRevision: 0,
				selectedProposalIds: []
			})
		)
		expect(noChange).toMatchObject({ documents: [], finalized: true })
		expect(noChangeHarness.createDocument).not.toHaveBeenCalled()
		expect(noChangeHarness.persistSourceRevisions).toHaveBeenCalledOnce()
	})

	it('prevents deletion when committed evidence permanence is incomplete', async () => {
		const accepted = proposal(1)
		const value = draft([accepted])
		const harness = setup(value)
		await runPromise(
			runStagedCommit(harness.operations, {
				campaignId: value.campaignId,
				ingestionId: value.ingestionId,
				expectedReviewRevision: 0,
				selectedProposalIds: [accepted.proposalId]
			})
		)
		harness.verifyPermanence.mockReturnValue(
			fail({
				domain: 'database',
				operation: 'verifyCampaignImportPermanence',
				cause: { name: 'CampaignImportPermanenceError', missingEvidenceLocators: ['locator'] }
			})
		)

		expect(
			await runPromise(flip(harness.operations.cleanup(value.campaignId, value.ingestionId)))
		).toMatchObject({
			operation: 'verifyCampaignImportPermanence',
			cause: { name: 'CampaignImportPermanenceError' }
		})
		expect(harness.cleanupCampaignImport).not.toHaveBeenCalled()
	})

	it('blocks cleanup when approved chronology provenance is incomplete', async () => {
		const accepted = proposal(1)
		const value = draft([accepted])
		value.temporalClaims = value.claims
		const harness = setup(value)
		await runPromise(
			runStagedCommit(harness.operations, {
				campaignId: value.campaignId,
				ingestionId: value.ingestionId,
				expectedReviewRevision: 0,
				selectedProposalIds: [accepted.proposalId]
			})
		)
		const chronologyId = '60000000-0000-5000-8000-000000000001'
		const sourceEventId = 'event-source'
		const targetEventId = 'event-target'
		const chronologyPlan: CampaignImportChronologyCommitPlanData = {
			schemaVersion: 1,
			kind: 'campaign-import-chronology-commit-plan',
			campaignId: value.campaignId,
			ingestionId: value.ingestionId,
			selectedChronology: [
				{
					chronologyId,
					relation: 'before',
					source: { eventId: sourceEventId, title: 'Source', source: 'existing' },
					target: { eventId: targetEventId, title: 'Target', source: 'existing' },
					certainty: 'explicit',
					reason: 'Evidence establishes the order.',
					selected: true,
					supportingClaimIds: [value.claims[0]!.claimId],
					evidence: value.claims[0]!.evidence
				}
			],
			plan: {
				planned: [],
				chronologyUpdates: [
					{
						mutationId: 'chronology-target',
						documentId: targetEventId,
						update: {
							type: 'event',
							after: [sourceEventId],
							during: [],
							eventForm: 'occurrence',
							content: '# Target',
							expectedRevisionId: 'target-revision',
							expectedPath: 'Events/target.md'
						}
					}
				],
				documentIdByProposal: {}
			}
		}
		harness.setJournal({
			schemaVersion: 1,
			campaignId: value.campaignId,
			ingestionId: value.ingestionId,
			applied: {
				'chronology-target': {
					mutationId: 'chronology-target',
					documentId: targetEventId,
					revisionId: 'chronology-revision'
				}
			}
		})
		harness.readChronologyPlan.mockReturnValue(succeed(chronologyPlan))
		harness.readLifecycleState.mockReturnValue(
			succeed({
				chronologyCommitData: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-commit',
					campaignId: value.campaignId,
					ingestionId: value.ingestionId,
					selectedChronologyIds: [chronologyId]
				},
				chronologyCompletion: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-completion',
					campaignId: value.campaignId,
					ingestionId: value.ingestionId,
					updatedDocumentIds: [targetEventId],
					finalized: true
				}
			} as never)
		)
		harness.verifyChronologyPermanence.mockReturnValue(
			fail({
				domain: 'database',
				operation: 'verifyCampaignImportChronologyPermanence',
				cause: {
					name: 'CampaignImportPermanenceError',
					missingChronologyProvenance: ['relationship-locator-revision']
				}
			})
		)

		expect(
			await runPromise(flip(harness.operations.cleanup(value.campaignId, value.ingestionId)))
		).toMatchObject({
			operation: 'verifyCampaignImportChronologyPermanence',
			cause: { missingChronologyProvenance: ['relationship-locator-revision'] }
		})
		expect(harness.cleanupCampaignImport).not.toHaveBeenCalled()
	})

	it('verifies complete evidence once and cleans up idempotently', async () => {
		const accepted = proposal(1)
		const value = draft([accepted])
		const harness = setup(value)
		await runPromise(
			runStagedCommit(harness.operations, {
				campaignId: value.campaignId,
				ingestionId: value.ingestionId,
				expectedReviewRevision: 0,
				selectedProposalIds: [accepted.proposalId]
			})
		)

		await runPromise(harness.operations.cleanup(value.campaignId, value.ingestionId))
		await runPromise(harness.operations.cleanup(value.campaignId, value.ingestionId))

		expect(harness.verifyPermanence).toHaveBeenCalledOnce()
		expect(harness.verifySourceBodies).toHaveBeenCalledOnce()
		expect(harness.markCleanupStarted).toHaveBeenCalledOnce()
		expect(harness.cleanupCampaignImport).toHaveBeenCalledTimes(2)
	})
})
