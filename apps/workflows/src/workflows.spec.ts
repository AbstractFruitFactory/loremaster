import { fail, succeed } from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
	CampaignImportChronologyBuildResult,
	CampaignImportChronologyDraft,
	CampaignImportDraft,
	CampaignImportRequestData,
	CampaignImportSourceAnalysis
} from '@loremaster/core/server/ingestion/types'

const dbos = vi.hoisted(() => ({
	registerWorkflow: vi.fn((workflow) => workflow),
	runStep: vi.fn(),
	setEvent: vi.fn(),
	startWorkflow: vi.fn()
}))

const runtime = vi.hoisted(() => ({
	campaignImport: {
		getRequest: vi.fn(),
		analyzePersistedSource: vi.fn(),
		buildDraft: vi.fn(),
		persistDraft: vi.fn(),
		chronology: {
			buildDraft: vi.fn(),
			persistDraft: vi.fn(),
			getCommitData: vi.fn()
		},
		commitOperations: {
			getCommitData: vi.fn(),
			planCommit: vi.fn(),
			commitMutationIds: vi.fn(),
			applyCommitMutation: vi.fn(),
			finalizeCommit: vi.fn(),
			recordChronologyDispatch: vi.fn()
		}
	}
}))

vi.mock('@dbos-inc/dbos-sdk', () => ({ DBOS: dbos }))
vi.mock('./runtime.js', () => ({ runtime }))

import {
	analyzeCampaignImport,
	analyzeCampaignImportChronology,
	commitCampaignImport,
	commitCampaignImportChronology
} from './workflows.js'

const campaignId = '40000000-0000-5000-8000-000000000001'
const ingestionId = '30000000-0000-5000-8000-000000000001'
const sourceId = '10000000-0000-5000-8000-000000000001'
const sourceRevisionId = '20000000-0000-5000-8000-000000000001'
const createdAt = '2026-09-19T08:00:00.000Z'

const request: CampaignImportRequestData = {
	schemaVersion: 1,
	kind: 'campaign-import',
	campaignId,
	ingestionId,
	createdAt,
	sources: [
		{
			displayName: 'notes.md',
			title: 'Notes',
			mediaType: 'text/markdown',
			sourceId,
			sourceRevisionId,
			contentHash: 'hash',
			byteLength: 7
		}
	]
}

const analysis: CampaignImportSourceAnalysis = {
	sourceId,
	sourceRevisionId,
	claims: [],
	warnings: []
}

const draft: CampaignImportDraft = {
	schemaVersion: 1,
	kind: 'campaign-import',
	campaignId,
	ingestionId,
	createdAt,
	sources: request.sources,
	claims: [],
	temporalClaims: [],
	proposals: [],
	warnings: []
}

const chronologyDraft: CampaignImportChronologyDraft = {
	schemaVersion: 1,
	kind: 'campaign-import-chronology',
	campaignId,
	ingestionId,
	createdAt,
	chronology: [],
	chronologyCoverage: [],
	warnings: []
}

const chronologyBuild: CampaignImportChronologyBuildResult = {
	draft: chronologyDraft,
	outcome: {
		schemaVersion: 1,
		kind: 'campaign-import-chronology-no-relations',
		campaignId,
		ingestionId,
		updatedDocumentIds: [],
		finalized: true
	}
}

describe('campaign import analysis workflow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbos.setEvent.mockResolvedValue(undefined)
		dbos.runStep.mockImplementation(
			async (operation: () => Promise<unknown>, options: { name: string }) => {
				if (options.name !== 'persist-campaign-import-draft') return operation()
				try {
					return await operation()
				} catch {
					return operation()
				}
			}
		)
		runtime.campaignImport.getRequest.mockReturnValue(succeed(request))
		runtime.campaignImport.analyzePersistedSource.mockReturnValue(succeed(analysis))
		runtime.campaignImport.buildDraft.mockReturnValue(succeed(draft))
	})

	it('records the built draft before retrying persistence with that exact value', async () => {
		const persisted: CampaignImportDraft[] = []
		runtime.campaignImport.persistDraft.mockImplementation((value: CampaignImportDraft) => {
			persisted.push(value)
			return persisted.length === 1
				? fail({
						domain: 'ingestionStorage',
						operation: 'writeCampaignImportDraft',
						cause: { reason: 'simulatedPostWriteFailure' }
					})
				: succeed(undefined)
		})

		await expect(analyzeCampaignImport({ campaignId, ingestionId })).resolves.toBe(draft)

		expect(runtime.campaignImport.buildDraft).toHaveBeenCalledOnce()
		expect(runtime.campaignImport.persistDraft).toHaveBeenCalledTimes(2)
		expect(persisted).toEqual([draft, draft])
		expect(persisted[0]).toBe(draft)
		expect(persisted[1]).toBe(draft)
		expect(dbos.runStep.mock.calls.map(([, options]) => options.name)).toEqual([
			'load-campaign-import-data',
			'analyze-campaign-import-source-1',
			'build-campaign-import-draft',
			'persist-campaign-import-draft'
		])
	})
})

describe('campaign import chronology analysis workflow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbos.setEvent.mockResolvedValue(undefined)
		dbos.runStep.mockImplementation(
			async (operation: () => Promise<unknown>, options: { name: string }) => {
				if (options.name !== 'persist-campaign-import-chronology-draft') return operation()
				try {
					return await operation()
				} catch {
					return operation()
				}
			}
		)
		runtime.campaignImport.chronology.buildDraft.mockReturnValue(succeed(chronologyBuild))
	})

	it('records inference output before retrying persistence with that exact value', async () => {
		const persisted: CampaignImportChronologyBuildResult[] = []
		runtime.campaignImport.chronology.persistDraft.mockImplementation(
			(value: CampaignImportChronologyBuildResult) => {
				persisted.push(value)
				return persisted.length === 1
					? fail({
							domain: 'ingestionStorage',
							operation: 'writeCampaignImportChronologyDraft',
							cause: { reason: 'simulatedPostWriteFailure' }
						})
					: succeed(undefined)
			}
		)

		await expect(analyzeCampaignImportChronology({ campaignId, ingestionId })).resolves.toBe(
			chronologyDraft
		)

		expect(runtime.campaignImport.chronology.buildDraft).toHaveBeenCalledOnce()
		expect(runtime.campaignImport.chronology.persistDraft).toHaveBeenCalledTimes(2)
		expect(persisted).toEqual([chronologyBuild, chronologyBuild])
		expect(persisted[0]).toBe(chronologyBuild)
		expect(persisted[1]).toBe(chronologyBuild)
		expect(dbos.runStep.mock.calls.map(([, options]) => options.name)).toEqual([
			'build-campaign-import-chronology-draft',
			'persist-campaign-import-chronology-draft'
		])
	})
})

describe('campaign import commit workflow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbos.setEvent.mockResolvedValue(undefined)
		dbos.runStep.mockImplementation((operation: () => Promise<unknown>) => operation())
		runtime.campaignImport.commitOperations.getCommitData.mockReturnValue(succeed({}))
		runtime.campaignImport.commitOperations.planCommit.mockReturnValue(
			succeed({ plan: { planned: [], chronologyUpdates: [] } })
		)
		runtime.campaignImport.commitOperations.commitMutationIds.mockReturnValue([])
		runtime.campaignImport.commitOperations.finalizeCommit.mockReturnValue(
			succeed({ documents: [], finalized: true })
		)
		runtime.campaignImport.commitOperations.recordChronologyDispatch.mockReturnValue(
			succeed(undefined)
		)
	})

	it('durably and idempotently dispatches chronology after base finalization', async () => {
		const handle = { workflowID: 'chronology-workflow' }
		const start = vi.fn().mockResolvedValue(handle)
		dbos.startWorkflow.mockReturnValue(start)

		await expect(commitCampaignImport({ campaignId, ingestionId })).resolves.toEqual({
			documents: [],
			finalized: true
		})

		expect(dbos.startWorkflow).toHaveBeenCalledWith(
			expect.any(Function),
			expect.objectContaining({
				workflowID: expect.stringContaining(ingestionId),
				duplicationPolicy: 'return-existing'
			})
		)
		expect(start).toHaveBeenCalledWith({ campaignId, ingestionId })
		expect(runtime.campaignImport.commitOperations.recordChronologyDispatch).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'dispatched', campaignId, ingestionId })
		)
		expect(dbos.runStep.mock.calls.map(([, options]) => options.name)).toContain(
			'dispatch-campaign-import-chronology'
		)
	})

	it('records dispatch failure while preserving successful base commit', async () => {
		dbos.startWorkflow.mockReturnValue(
			vi.fn().mockRejectedValue(new Error('chronology queue unavailable'))
		)

		await expect(commitCampaignImport({ campaignId, ingestionId })).resolves.toEqual({
			documents: [],
			finalized: true
		})

		expect(runtime.campaignImport.commitOperations.recordChronologyDispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'failed',
				error: {
					code: 'chronology.dispatchFailed',
					message: 'Chronology analysis could not be dispatched.'
				}
			})
		)
	})
})

describe('campaign import chronology commit workflow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbos.setEvent.mockResolvedValue(undefined)
		dbos.runStep.mockImplementation((operation: () => Promise<unknown>) => operation())
	})

	it('publishes a loading stage before reading commit data', async () => {
		runtime.campaignImport.chronology.getCommitData.mockReturnValue(
			fail({
				domain: 'ingestionStorage',
				operation: 'readCampaignImportChronologyCommitData',
				cause: new Error('missing chronology commit data')
			})
		)

		await expect(commitCampaignImportChronology({ campaignId, ingestionId })).rejects.toThrow()
		expect(dbos.setEvent).toHaveBeenCalledWith('loremaster.progress', {
			stage: 'loading-import-data',
			completed: 0,
			total: 1
		})
	})
})
