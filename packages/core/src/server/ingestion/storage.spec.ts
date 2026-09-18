import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flip, runPromise } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitMutationId, ingestionDocumentId } from './ids.js'
import { filesystemIngestionStorage } from './storage.js'
import type {
	SessionCommitJournal,
	SessionCommitData,
	SessionIngestionDraft,
	SessionTranscriptData
} from './types.js'

let root = ''

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'loremaster-ingestion-'))
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

const transcriptData: SessionTranscriptData = {
	schemaVersion: 1,
	ingestionId: 'ingestion-1',
	campaignId: 'campaign-1',
	title: 'Session 1',
	transcript: 'The gate opened.'
}

const draft: SessionIngestionDraft = {
	schemaVersion: 3,
	ingestionId: transcriptData.ingestionId,
	campaignId: transcriptData.campaignId,
	title: transcriptData.title,
	createdAt: '2026-09-17T20:00:00.000Z',
	warnings: [],
	proposals: [],
	chronology: [],
	chronologyCoverage: []
}

describe('durable ingestion storage', () => {
	it('persists equal requests and drafts idempotently and rejects conflicts', async () => {
		const storage = filesystemIngestionStorage(root)

		await runPromise(storage.writeTranscriptData!(transcriptData))
		await runPromise(storage.writeTranscriptData!(transcriptData))
		await runPromise(storage.writeDraft!(draft))
		await runPromise(storage.writeDraft!(draft))

		expect(
			await runPromise(
				storage.readTranscriptData!(transcriptData.campaignId, transcriptData.ingestionId)
			)
		).toEqual(transcriptData)
		expect(
			await runPromise(storage.read(transcriptData.campaignId, transcriptData.ingestionId))
		).toEqual(draft)
		expect(
			await runPromise(
				flip(
					storage.writeTranscriptData!({ ...transcriptData, transcript: 'Different transcript.' })
				)
			)
		).toMatchObject({ operation: 'writeTranscriptData' })
		expect(
			await runPromise(flip(storage.writeDraft!({ ...draft, title: 'Different title' })))
		).toMatchObject({ operation: 'writeDraft' })
	})

	it('persists immutable commit requests and replaceable journals', async () => {
		const storage = filesystemIngestionStorage(root)
		const commitData: SessionCommitData = {
			schemaVersion: 1,
			campaignId: transcriptData.campaignId,
			ingestionId: transcriptData.ingestionId,
			selectedProposalIds: ['proposal-1']
		}
		const mutationId = commitMutationId(
			transcriptData.ingestionId,
			'create',
			'document-1',
			'proposal-1'
		)
		const journal: SessionCommitJournal = {
			schemaVersion: 1,
			campaignId: transcriptData.campaignId,
			ingestionId: transcriptData.ingestionId,
			applied: {}
		}

		await runPromise(storage.writeCommitData!(commitData))
		await runPromise(storage.writeCommitData!(commitData))
		expect(
			await runPromise(
				storage.readCommitData!(transcriptData.campaignId, transcriptData.ingestionId)
			)
		).toEqual(commitData)
		expect(
			await runPromise(
				flip(
					storage.writeCommitData!({
						...commitData,
						selectedProposalIds: ['proposal-2']
					})
				)
			)
		).toMatchObject({ operation: 'writeCommitData' })
		expect(
			await runPromise(
				storage.readCommitJournal!(transcriptData.campaignId, transcriptData.ingestionId)
			)
		).toBeUndefined()

		await runPromise(storage.writeCommitJournal!(journal))
		journal.applied[mutationId] = {
			mutationId,
			documentId: 'document-1',
			proposalId: 'proposal-1',
			documentType: 'session'
		}
		await runPromise(storage.writeCommitJournal!(journal))

		expect(
			await runPromise(
				storage.readCommitJournal!(transcriptData.campaignId, transcriptData.ingestionId)
			)
		).toEqual(journal)
	})

	it('derives stable document and mutation IDs', () => {
		expect(ingestionDocumentId('ingestion-1', 'proposal-1')).toBe(
			ingestionDocumentId('ingestion-1', 'proposal-1')
		)
		expect(ingestionDocumentId('ingestion-1', 'proposal-1')).not.toBe(
			ingestionDocumentId('ingestion-1', 'proposal-2')
		)
		expect(commitMutationId('ingestion-1', 'create', 'document-1', 'proposal-1')).not.toBe(
			commitMutationId('ingestion-1', 'update', 'document-1', 'proposal-1')
		)
	})
})
