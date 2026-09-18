import { fail, flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../../vault/types.js'
import type { CommitInput, MutationPlan } from '../internal.js'
import type { IngestionStorage } from '../storage.js'
import type { SessionCommitJournal, SessionIngestionDraft, SessionProposal } from '../types.js'
import { commitRevisionId } from '../ids.js'
import { commitApplication } from './application.js'

const input: CommitInput = {
	campaignId: 'campaign-1',
	ingestionId: 'ingestion-1',
	selectedProposalIds: []
}

const draft: SessionIngestionDraft = {
	schemaVersion: 3,
	ingestionId: input.ingestionId,
	campaignId: input.campaignId,
	title: 'Session 1',
	createdAt: '2026-09-17T20:00:00.000Z',
	warnings: [],
	proposals: [],
	chronology: [],
	chronologyCoverage: []
}

const document = (overrides: Partial<VaultDocument> = {}): VaultDocument => ({
	id: 'document-1',
	path: 'NPCs/varek.md',
	title: 'Varek',
	type: 'npc',
	after: [],
	during: [],
	summary: '',
	content: '# Varek',
	links: [],
	currentRevisionId: 'revision-1',
	...overrides
})

const proposal = (overrides: Partial<SessionProposal> = {}): SessionProposal => ({
	proposalId: 'proposal-1',
	claimIds: [],
	operation: 'update-canon',
	documentType: 'npc',
	title: 'Varek',
	certainty: 'explicit',
	selected: true,
	evidence: [],
	match: { kind: 'exact', documentId: 'document-1', title: 'Varek', documentType: 'npc' },
	references: [],
	content: 'New fact.',
	base: { documentId: 'document-1', revisionId: 'revision-1' },
	patch: { kind: 'append', content: 'New fact.' },
	...overrides
})

const storageHarness = () => {
	let journal: SessionCommitJournal | undefined
	const storage: IngestionStorage = {
		write: () => succeed(undefined),
		read: () => succeed(draft),
		readTranscript: () => succeed('Transcript'),
		readCommitJournal: () => succeed(journal),
		writeCommitJournal: (next) => {
			journal = structuredClone(next)
			return succeed(undefined)
		}
	}
	return { storage, getJournal: () => journal }
}

const planFor = (values: Partial<MutationPlan>): MutationPlan => ({
	planned: [],
	chronologyUpdates: [],
	documentIdByProposal: {},
	existingById: {},
	sessionDocumentId: 'session-document',
	...values
})

describe('commit mutation application', () => {
	it('returns journaled results without reapplying a mutation', async () => {
		const sessionProposal = proposal({
			proposalId: 'session-proposal',
			operation: 'create-entity',
			documentType: 'session',
			title: 'Session 1',
			content: '# Session 1',
			match: { kind: 'unresolved', candidates: [] },
			base: undefined,
			patch: undefined
		})
		const plan = planFor({
			planned: [
				{
					mutationId: 'mutation-1',
					proposal: sessionProposal,
					documentId: 'session-document',
					path: 'Sessions/session-1.md'
				}
			],
			documentIdByProposal: { 'session-proposal': 'session-document' }
		})
		const documents: VaultDocument[] = []
		const { storage } = storageHarness()
		const createDocument = vi.fn((_campaignId: string, createInput: { documentId?: string }) => {
			documents.push(
				document({
					id: createInput.documentId!,
					path: 'Sessions/session-1.md',
					title: 'Session 1',
					type: 'session',
					content: '# Session 1',
					ingestionId: input.ingestionId,
					transcript: 'Transcript'
				})
			)
			return succeed(documents[0]!)
		})
		const { applyMutationPlan } = commitApplication(
			{
				getDocuments: () => succeed(documents),
				createDocument,
				updateDocument: () => succeed({} as VaultDocument)
			},
			storage
		)

		const first = await runPromise(
			applyMutationPlan(input, draft, 'Transcript', [sessionProposal], plan)
		)
		const second = await runPromise(
			applyMutationPlan(input, draft, 'Transcript', [sessionProposal], plan)
		)

		expect(createDocument).toHaveBeenCalledTimes(1)
		expect(second).toEqual(first)
	})

	it('reconciles a create before replacing a missing journal entry', async () => {
		const sessionProposal = proposal({
			proposalId: 'session-proposal',
			operation: 'create-entity',
			documentType: 'session',
			title: 'Session 1',
			content: '# Session 1',
			match: { kind: 'unresolved', candidates: [] },
			base: undefined,
			patch: undefined
		})
		const current = document({
			id: 'session-document',
			path: 'Sessions/session-1.md',
			title: 'Session 1',
			type: 'session',
			content: '# Session 1',
			ingestionId: input.ingestionId,
			transcript: 'Transcript'
		})
		const plan = planFor({
			planned: [
				{
					mutationId: 'create-mutation',
					proposal: sessionProposal,
					documentId: current.id,
					path: current.path
				}
			]
		})
		const { storage, getJournal } = storageHarness()
		const createDocument = vi.fn(() => succeed(current))
		const { applyMutationPlan } = commitApplication(
			{
				getDocuments: () => succeed([current]),
				createDocument,
				updateDocument: () => succeed(current)
			},
			storage
		)

		await runPromise(applyMutationPlan(input, draft, 'Transcript', [sessionProposal], plan))

		expect(createDocument).toHaveBeenCalledWith(
			input.campaignId,
			expect.objectContaining({
				revision: expect.objectContaining({
					revisionId: commitRevisionId('create-mutation')
				})
			})
		)
		expect(getJournal()?.applied['create-mutation']).toMatchObject({
			documentId: current.id,
			proposalId: sessionProposal.proposalId
		})
	})

	it('reconciles a proposal update before replacing a missing journal entry', async () => {
		const updateProposal = proposal()
		const base = document()
		const current = document({
			content: '# Varek\n\nNew fact.\n',
			currentRevisionId: 'revision-2'
		})
		const plan = planFor({
			planned: [
				{
					mutationId: 'update-mutation',
					proposal: updateProposal,
					documentId: base.id,
					after: [],
					during: []
				}
			],
			existingById: { [base.id]: base }
		})
		const { storage, getJournal } = storageHarness()
		const updateDocument = vi.fn(() => succeed(current))
		const { applyMutationPlan } = commitApplication(
			{
				getDocuments: () => succeed([current]),
				createDocument: () => succeed(current),
				updateDocument
			},
			storage
		)

		await runPromise(applyMutationPlan(input, draft, 'Transcript', [updateProposal], plan))

		expect(updateDocument).toHaveBeenCalledWith(
			input.campaignId,
			base.id,
			expect.objectContaining({
				expectedPath: base.path,
				revision: expect.objectContaining({
					revisionId: commitRevisionId('update-mutation')
				})
			})
		)
		expect(getJournal()?.applied['update-mutation']).toMatchObject({ documentId: base.id })
	})

	it('reconciles chronology before replacing a missing journal entry', async () => {
		const base = document({
			id: 'event-1',
			path: 'Events/event-1.md',
			type: 'event',
			eventForm: 'occurrence',
			content: '# Event 1'
		})
		const current = document({
			...base,
			after: ['event-0'],
			eventForm: 'period',
			currentRevisionId: 'revision-2'
		})
		const plan = planFor({
			chronologyUpdates: [
				{
					mutationId: 'chronology-mutation',
					documentId: base.id,
					after: ['event-0'],
					during: [],
					eventForm: 'period'
				}
			],
			existingById: { [base.id]: base }
		})
		const { storage, getJournal } = storageHarness()
		const updateDocument = vi.fn(() => succeed(current))
		const { applyMutationPlan } = commitApplication(
			{
				getDocuments: () => succeed([current]),
				createDocument: () => succeed(current),
				updateDocument
			},
			storage
		)

		await runPromise(applyMutationPlan(input, draft, 'Transcript', [], plan))

		expect(updateDocument).toHaveBeenCalledWith(
			input.campaignId,
			base.id,
			expect.objectContaining({
				expectedPath: base.path,
				revision: expect.objectContaining({
					revisionId: commitRevisionId('chronology-mutation')
				})
			})
		)
		expect(getJournal()?.applied['chronology-mutation']).toEqual({
			mutationId: 'chronology-mutation',
			documentId: base.id
		})
	})

	it('preserves a conflict when current state differs from the expected post-state', async () => {
		const updateProposal = proposal()
		const base = document()
		const current = document({
			content: '# Varek\n\nUnrelated edit.',
			currentRevisionId: 'revision-2'
		})
		const plan = planFor({
			planned: [
				{
					mutationId: 'update-mutation',
					proposal: updateProposal,
					documentId: base.id,
					after: [],
					during: []
				}
			],
			existingById: { [base.id]: base }
		})
		const { storage } = storageHarness()
		const updateDocument = vi.fn(() =>
			fail({
				domain: 'vaultRevision',
				operation: 'verifyBase',
				cause: { reason: 'revisionMismatch' }
			})
		)
		const { applyMutationPlan } = commitApplication(
			{
				getDocuments: () => succeed([current]),
				createDocument: () => succeed(current),
				updateDocument
			},
			storage
		)

		const failure = await runPromise(
			flip(applyMutationPlan(input, draft, 'Transcript', [updateProposal], plan))
		)

		expect(updateDocument).toHaveBeenCalledTimes(1)
		expect(failure).toMatchObject({
			domain: 'vaultRevision',
			operation: 'verifyBase',
			cause: { reason: 'revisionMismatch' }
		})
	})
})
