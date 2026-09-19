import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flip, runPromise } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	campaignImportContentHash,
	campaignImportSourceId,
	campaignImportSourceRevisionId
} from './ids.js'
import { initialCampaignImportReviewState } from './import-review.js'
import { filesystemIngestionStorage } from './storage.js'
import type {
	CampaignImportDraft,
	CampaignImportRequestData,
	CampaignImportSourceData
} from './types.js'

let root = ''

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'loremaster-import-'))
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

const campaignId = 'campaign-1'
const ingestionId = 'import-1'
const displayName = 'characters/mara.md'
const content = '# Mara Vale\n\nMara carries a blue lantern.'
const sourceId = campaignImportSourceId(ingestionId, 0)
const contentHash = campaignImportContentHash(content)
const importedSource: CampaignImportSourceData = {
	displayName,
	sourceId,
	title: 'Mara Vale',
	mediaType: 'text/markdown',
	content,
	sourceRevisionId: campaignImportSourceRevisionId(sourceId, contentHash),
	contentHash,
	byteLength: Buffer.byteLength(content)
}
const { content: _content, ...sourceDescriptor } = importedSource

const request: CampaignImportRequestData = {
	schemaVersion: 1,
	kind: 'campaign-import',
	ingestionId,
	campaignId,
	createdAt: '2026-09-19T08:00:00.000Z',
	sources: [sourceDescriptor]
}

const draft: CampaignImportDraft = {
	schemaVersion: 1,
	kind: 'campaign-import',
	ingestionId: request.ingestionId,
	campaignId: request.campaignId,
	createdAt: '2026-09-19T08:00:00.000Z',
	sources: request.sources,
	claims: [],
	temporalClaims: [],
	proposals: [],
	warnings: []
}

const writeOwnerLease = async (
	path: string,
	ownerToken: string,
	acquiredAt = '2000-01-01T00:00:00.000Z'
) => {
	await mkdir(path, { recursive: true })
	await writeFile(join(path, `${ownerToken}.json`), JSON.stringify({ ownerToken, acquiredAt }), {
		encoding: 'utf8',
		flag: 'wx'
	})
	await utimes(join(path, `${ownerToken}.json`), new Date(acquiredAt), new Date(acquiredAt))
}

const ownerLeaseFiles = async (path: string) => {
	try {
		return await readdir(path)
	} catch (cause) {
		if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
			return []
		}
		throw cause
	}
}

describe('campaign import filesystem storage', () => {
	it('persists request, source revisions, and drafts immutably', async () => {
		const storage = filesystemIngestionStorage(root)

		const firstRequest = await runPromise(
			storage.writeCampaignImportData!(request, [importedSource])
		)
		const retriedRequest = await runPromise(
			storage.writeCampaignImportData!({ ...request, createdAt: '2026-09-19T10:00:00.000Z' }, [
				importedSource
			])
		)
		await runPromise(storage.writeCampaignImportDraft!(draft))
		await runPromise(storage.writeCampaignImportDraft!(draft))

		expect(firstRequest).toEqual(request)
		expect(retriedRequest).toEqual(request)
		expect(
			await runPromise(storage.readCampaignImportData!(request.campaignId, request.ingestionId))
		).toEqual(request)
		expect(
			await runPromise(
				storage.readCampaignImportSource!(
					request.campaignId,
					importedSource.sourceId,
					importedSource.sourceRevisionId
				)
			)
		).toBe(content)
		expect(
			await runPromise(storage.readCampaignImportDraft!(request.campaignId, request.ingestionId))
		).toEqual(draft)

		expect(
			await runPromise(
				flip(
					storage.writeCampaignImportData!(
						{
							...request,
							sources: [{ ...sourceDescriptor, title: 'Changed source title' }]
						},
						[{ ...importedSource, title: 'Changed source title' }]
					)
				)
			)
		).toMatchObject({ operation: 'writeCampaignImportData' })
		const changedContent = '# Mara Vale\n\nMara carries a red lantern.'
		const changedContentHash = campaignImportContentHash(changedContent)
		const changedSource = {
			...importedSource,
			content: changedContent,
			contentHash: changedContentHash,
			sourceRevisionId: campaignImportSourceRevisionId(sourceId, changedContentHash),
			byteLength: Buffer.byteLength(changedContent)
		}
		const { content: _changedContent, ...changedSourceDescriptor } = changedSource
		expect(
			await runPromise(
				flip(
					storage.writeCampaignImportData!(
						{
							...request,
							createdAt: '2026-09-19T10:00:00.000Z',
							sources: [changedSourceDescriptor]
						},
						[changedSource]
					)
				)
			)
		).toMatchObject({
			operation: 'writeCampaignImportData',
			cause: { name: 'ImmutableIngestionConflictError' }
		})
		expect(
			await runPromise(
				flip(
					storage.writeCampaignImportDraft!({
						...draft,
						warnings: ['Different analysis']
					})
				)
			)
		).toMatchObject({ operation: 'writeCampaignImportDraft' })
	})

	it('derives source identity from the ingestion and source slot', () => {
		expect(campaignImportSourceId(ingestionId, 0)).toBe(sourceId)
		expect(campaignImportSourceId(ingestionId, 1)).not.toBe(sourceId)
		expect(campaignImportSourceId('import-2', 0)).not.toBe(sourceId)
		expect(campaignImportSourceRevisionId(sourceId, contentHash)).toBe(
			importedSource.sourceRevisionId
		)
	})

	it('initializes, reloads, and revision-checks atomically written review state', async () => {
		const storage = filesystemIngestionStorage(root)
		const initial = initialCampaignImportReviewState(draft)
		await runPromise(storage.initializeCampaignImportReviewState!(initial))
		await runPromise(
			storage.initializeCampaignImportReviewState!({
				...initial,
				revision: 99,
				selectedProposalIds: ['must-not-replace']
			})
		)

		expect(
			await runPromise(storage.readCampaignImportReviewState!(campaignId, ingestionId))
		).toEqual(initial)

		const updated = {
			...initial,
			revision: 1,
			updatedAt: '2026-09-19T09:00:00.000Z'
		}
		await runPromise(storage.updateCampaignImportReviewState!(updated, 0))
		expect(
			await runPromise(storage.readCampaignImportReviewState!(campaignId, ingestionId))
		).toEqual(updated)

		expect(
			await runPromise(
				flip(storage.updateCampaignImportReviewState!({ ...updated, revision: 2 }, 0))
			)
		).toMatchObject({
			operation: 'updateCampaignImportReviewState',
			cause: { name: 'CampaignImportReviewRevisionConflictError' }
		})

		for (const commit of [
			{
				expectedReviewRevision: 0,
				selectedProposalIds: [] as string[]
			},
			{
				expectedReviewRevision: 1,
				selectedProposalIds: ['different-proposal']
			}
		]) {
			expect(
				await runPromise(
					flip(
						storage.writeCampaignImportCommitData!({
							schemaVersion: 1,
							kind: 'campaign-import-commit',
							campaignId,
							ingestionId,
							resolutions: [],
							...commit
						})
					)
				)
			).toMatchObject({
				operation: 'writeCampaignImportCommitData',
				cause: { name: 'CampaignImportReviewCommitConflictError' }
			})
		}

		await runPromise(
			storage.writeCampaignImportCommitData!({
				schemaVersion: 1,
				kind: 'campaign-import-commit',
				campaignId,
				ingestionId,
				expectedReviewRevision: 1,
				selectedProposalIds: []
			})
		)
		expect(
			await runPromise(
				flip(storage.updateCampaignImportReviewState!({ ...updated, revision: 2 }, 1))
			)
		).toMatchObject({
			operation: 'updateCampaignImportReviewState',
			cause: { name: 'CampaignImportReviewLockedError' }
		})
	})

	it('serializes review save and commit across filesystem adapter instances', async () => {
		const first = filesystemIngestionStorage(root)
		const second = filesystemIngestionStorage(root)
		const initial = initialCampaignImportReviewState(draft)
		await runPromise(first.initializeCampaignImportReviewState(initial))
		const updated = {
			...initial,
			revision: 1,
			updatedAt: '2026-09-19T09:00:00.000Z'
		}

		const results = await Promise.allSettled([
			runPromise(first.updateCampaignImportReviewState(updated, 0)),
			runPromise(
				second.writeCampaignImportCommitData({
					schemaVersion: 1,
					kind: 'campaign-import-commit',
					campaignId,
					ingestionId,
					expectedReviewRevision: 0,
					selectedProposalIds: []
				})
			)
		])
		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)

		const current = await runPromise(first.readCampaignImportReviewState(campaignId, ingestionId))
		if (results[1]?.status === 'rejected') {
			await runPromise(
				second.writeCampaignImportCommitData({
					schemaVersion: 1,
					kind: 'campaign-import-commit',
					campaignId,
					ingestionId,
					expectedReviewRevision: current.revision,
					selectedProposalIds: current.selectedProposalIds,
					resolutions: current.resolutions
				})
			)
		}
		expect(
			await runPromise(
				flip(
					first.updateCampaignImportReviewState(
						{
							...current,
							revision: current.revision + 1,
							updatedAt: '2026-09-19T10:00:00.000Z'
						},
						current.revision
					)
				)
			)
		).toMatchObject({ cause: { name: 'CampaignImportReviewLockedError' } })
	})

	it('recovers stale review locks before updating state', async () => {
		const storage = filesystemIngestionStorage(root)
		const importRoot = join(root, campaignId, '.loremaster', 'ingestions', ingestionId)
		await mkdir(importRoot, { recursive: true })
		await writeOwnerLease(join(importRoot, '.review-state.lock'), 'abandoned-review-owner')

		await expect(
			runPromise(
				storage.initializeCampaignImportReviewState(initialCampaignImportReviewState(draft))
			)
		).resolves.toBeUndefined()
	})

	it('keeps stale review recovery to one owner across simultaneous adapters', async () => {
		const adapters = [filesystemIngestionStorage(root), filesystemIngestionStorage(root)]
		const initial = initialCampaignImportReviewState(draft)
		await runPromise(adapters[0].initializeCampaignImportReviewState(initial))
		const lockPath = join(
			root,
			campaignId,
			'.loremaster',
			'ingestions',
			ingestionId,
			'.review-state.lock'
		)
		let maxConcurrentOwners = 0

		for (let revision = 0; revision < 8; revision += 1) {
			await writeOwnerLease(lockPath, `abandoned-review-owner-${revision}`)
			const results = await Promise.allSettled(
				Array.from({ length: 32 }, (_, index) =>
					runPromise(
						adapters[index % adapters.length]!.updateCampaignImportReviewState(
							{
								...initial,
								revision: revision + 1,
								updatedAt: `2026-09-19T09:00:${revision.toString().padStart(2, '0')}.000Z`
							},
							revision
						)
					)
				)
			)
			let owners = results.filter(({ status }) => status === 'fulfilled').length
			expect(owners).toBeLessThanOrEqual(1)
			if (owners === 0) {
				await runPromise(
					adapters[0].updateCampaignImportReviewState(
						{
							...initial,
							revision: revision + 1,
							updatedAt: `2026-09-19T09:00:${revision.toString().padStart(2, '0')}.000Z`
						},
						revision
					)
				)
				owners = 1
			}
			maxConcurrentOwners = Math.max(maxConcurrentOwners, owners)
			expect(owners).toBe(1)
			expect(await ownerLeaseFiles(lockPath)).toEqual([])
		}

		expect(maxConcurrentOwners).toBe(1)
	}, 15_000)

	it('rejects source content that does not match immutable revision metadata', async () => {
		const storage = filesystemIngestionStorage(root)

		expect(
			await runPromise(
				flip(
					storage.writeCampaignImportData!(request, [
						{ ...importedSource, content: 'Different source content' }
					])
				)
			)
		).toMatchObject({
			operation: 'writeCampaignImportData',
			cause: { name: 'CampaignImportSourceIntegrityError' }
		})
	})

	it('commits only the selected resolution projection from the acknowledged review', async () => {
		const storage = filesystemIngestionStorage(root)
		await runPromise(
			storage.initializeCampaignImportReviewState!({
				schemaVersion: 1,
				campaignId,
				ingestionId,
				revision: 4,
				updatedAt: request.createdAt,
				selectedProposalIds: ['selected-proposal'],
				resolutions: [
					{ proposalId: 'selected-proposal', kind: 'create' },
					{ proposalId: 'unselected-proposal', kind: 'create' }
				]
			})
		)

		expect(
			await runPromise(
				flip(
					storage.writeCampaignImportCommitData!({
						schemaVersion: 1,
						kind: 'campaign-import-commit',
						campaignId,
						ingestionId,
						expectedReviewRevision: 4,
						selectedProposalIds: ['selected-proposal'],
						resolutions: []
					})
				)
			)
		).toMatchObject({
			cause: { name: 'CampaignImportReviewCommitConflictError' }
		})

		await runPromise(
			storage.writeCampaignImportCommitData!({
				schemaVersion: 1,
				kind: 'campaign-import-commit',
				campaignId,
				ingestionId,
				expectedReviewRevision: 4,
				selectedProposalIds: ['selected-proposal'],
				resolutions: [{ proposalId: 'selected-proposal', kind: 'create' }]
			})
		)
	})

	it('lists imports through base completion until final cleanup', async () => {
		const storage = filesystemIngestionStorage(root)
		await runPromise(storage.writeCampaignImportData!(request, [importedSource]))
		await runPromise(
			storage.writeTranscriptData!({
				schemaVersion: 1,
				campaignId,
				ingestionId: 'session-1',
				title: 'Session',
				transcript: 'A transcript'
			})
		)

		expect(await runPromise(storage.list!(campaignId))).toEqual([
			expect.objectContaining({ ingestionId: 'session-1', phase: 'analyzing' })
		])
		const analyzing = await runPromise(storage.listCampaignImports!(campaignId))
		expect(analyzing).toEqual([
			expect.objectContaining({
				ingestionId: request.ingestionId,
				createdAt: request.createdAt,
				phase: 'analyzing'
			})
		])
		expect(analyzing[0]).not.toHaveProperty('title')

		await runPromise(storage.writeCampaignImportDraft!(draft))
		await runPromise(
			storage.initializeCampaignImportReviewState!(initialCampaignImportReviewState(draft))
		)
		expect(await runPromise(storage.listCampaignImports!(campaignId))).toEqual([
			expect.objectContaining({ ingestionId: request.ingestionId, phase: 'review' })
		])

		await runPromise(
			storage.writeCampaignImportCommitData!({
				schemaVersion: 1,
				kind: 'campaign-import-commit',
				campaignId,
				ingestionId: request.ingestionId,
				expectedReviewRevision: 0,
				selectedProposalIds: []
			})
		)
		expect(await runPromise(storage.listCampaignImports!(campaignId))).toEqual([
			expect.objectContaining({
				ingestionId: request.ingestionId,
				phase: 'committing',
				canDiscard: false
			})
		])
		expect(
			await runPromise(flip(storage.discardCampaignImport!(campaignId, request.ingestionId)))
		).toMatchObject({ cause: { name: 'CommitStartedIngestionDiscardError' } })

		await runPromise(
			storage.writeCampaignImportCompletion!({
				schemaVersion: 1,
				kind: 'campaign-import-completion',
				campaignId,
				ingestionId: request.ingestionId,
				documents: [],
				finalized: true
			})
		)
		expect(await runPromise(storage.listCampaignImports!(campaignId))).toEqual([
			expect.objectContaining({
				ingestionId: request.ingestionId,
				phase: 'chronology-analyzing',
				canDiscard: false
			})
		])
		await runPromise(
			storage.writeCampaignImportChronologyDispatch!({
				schemaVersion: 1,
				kind: 'campaign-import-chronology-dispatch',
				campaignId,
				ingestionId: request.ingestionId,
				status: 'failed',
				updatedAt: request.createdAt
			})
		)
		expect(await runPromise(storage.listCampaignImports!(campaignId))).toEqual([
			expect.objectContaining({ ingestionId: request.ingestionId, phase: 'failed' })
		])
		await runPromise(
			storage.writeCampaignImportChronologyCompletion({
				schemaVersion: 1,
				kind: 'campaign-import-chronology-no-relations',
				campaignId,
				ingestionId: request.ingestionId,
				updatedDocumentIds: [],
				finalized: true
			})
		)
		expect(await runPromise(storage.listCampaignImports!(campaignId))).toEqual([
			expect.objectContaining({
				ingestionId: request.ingestionId,
				phase: 'ready-to-finish',
				canDiscard: false
			})
		])
		await runPromise(storage.verifyCampaignImportSourceBodies!(campaignId, request.sources))
		await runPromise(storage.markCampaignImportCleanupStarted(campaignId, request.ingestionId))
		expect(
			await runPromise(storage.isCampaignImportCleanupStarted(campaignId, request.ingestionId))
		).toBe(true)

		await runPromise(storage.cleanupCampaignImport!(campaignId, request.ingestionId))
		await runPromise(storage.cleanupCampaignImport!(campaignId, request.ingestionId))
		expect(
			await runPromise(storage.isCampaignImportCleanupStarted(campaignId, request.ingestionId))
		).toBe(true)
		expect(
			await runPromise(
				storage.readCampaignImportSource!(
					request.campaignId,
					importedSource.sourceId,
					importedSource.sourceRevisionId
				)
			)
		).toBe(content)
		expect(await runPromise(storage.readTranscriptData!(campaignId, 'session-1'))).toMatchObject({
			title: 'Session',
			transcript: 'A transcript'
		})
		expect(await runPromise(storage.list!(campaignId))).toEqual([
			expect.objectContaining({ ingestionId: 'session-1', title: 'Session' })
		])
	})

	it('serializes operation leases across adapters and recovers stale owners', async () => {
		const finishStorage = filesystemIngestionStorage(root)
		const retryStorage = filesystemIngestionStorage(root)
		const finishLease = await runPromise(
			finishStorage.acquireCampaignImportOperationLease(campaignId, ingestionId)
		)

		let retryStarted = false
		await expect(
			(async () => {
				const lease = await runPromise(
					retryStorage.acquireCampaignImportOperationLease(campaignId, ingestionId)
				)
				retryStarted = true
				await runPromise(
					retryStorage.releaseCampaignImportOperationLease(campaignId, ingestionId, lease)
				)
			})()
		).rejects.toThrow('CampaignImportOperationLeaseBusyError')
		expect(retryStarted).toBe(false)
		expect(
			await runPromise(
				flip(
					retryStorage.releaseCampaignImportOperationLease(campaignId, ingestionId, {
						ownerToken: 'not-the-owner'
					})
				)
			)
		).toMatchObject({ operation: 'releaseCampaignImportOperationLease' })
		expect(
			await runPromise(
				flip(retryStorage.acquireCampaignImportOperationLease(campaignId, ingestionId))
			)
		).toMatchObject({ cause: { name: 'CampaignImportOperationLeaseBusyError' } })
		await runPromise(
			finishStorage.releaseCampaignImportOperationLease(campaignId, ingestionId, finishLease)
		)

		const retryLease = await runPromise(
			retryStorage.acquireCampaignImportOperationLease(campaignId, ingestionId)
		)
		let deletionStarted = false
		await expect(
			(async () => {
				const lease = await runPromise(
					finishStorage.acquireCampaignImportOperationLease(campaignId, ingestionId)
				)
				deletionStarted = true
				await runPromise(
					finishStorage.releaseCampaignImportOperationLease(campaignId, ingestionId, lease)
				)
			})()
		).rejects.toThrow('CampaignImportOperationLeaseBusyError')
		expect(deletionStarted).toBe(false)
		await runPromise(
			retryStorage.releaseCampaignImportOperationLease(campaignId, ingestionId, retryLease)
		)

		const leasePath = join(
			root,
			campaignId,
			'.loremaster',
			'import-operation-locks',
			`${ingestionId}.lock`
		)
		await writeOwnerLease(leasePath, 'abandoned-operation-owner')
		const recovered = await runPromise(
			finishStorage.acquireCampaignImportOperationLease(campaignId, ingestionId)
		)
		await runPromise(
			finishStorage.releaseCampaignImportOperationLease(campaignId, ingestionId, recovered)
		)
	})

	it('keeps stale operation recovery to one concurrent owner', async () => {
		const adapters = [filesystemIngestionStorage(root), filesystemIngestionStorage(root)]
		const leasePath = join(
			root,
			campaignId,
			'.loremaster',
			'import-operation-locks',
			`${ingestionId}.lock`
		)
		await writeOwnerLease(leasePath, 'abandoned-operation-owner')
		let activeOwners = 0
		let maxConcurrentOwners = 0

		const results = await Promise.all(
			Array.from({ length: 64 }, async (_, index) => {
				const storage = adapters[index % adapters.length]!
				try {
					const lease = await runPromise(
						storage.acquireCampaignImportOperationLease(campaignId, ingestionId)
					)
					activeOwners += 1
					maxConcurrentOwners = Math.max(maxConcurrentOwners, activeOwners)
					await new Promise((resolve) => setTimeout(resolve, 5))
					activeOwners -= 1
					await runPromise(
						storage.releaseCampaignImportOperationLease(campaignId, ingestionId, lease)
					)
					return true
				} catch {
					return false
				}
			})
		)

		if (!results.includes(true)) {
			const recovered = await runPromise(
				adapters[0].acquireCampaignImportOperationLease(campaignId, ingestionId)
			)
			activeOwners += 1
			maxConcurrentOwners = Math.max(maxConcurrentOwners, activeOwners)
			activeOwners -= 1
			await runPromise(
				adapters[0].releaseCampaignImportOperationLease(campaignId, ingestionId, recovered)
			)
		}
		expect(maxConcurrentOwners).toBe(1)
		expect(await ownerLeaseFiles(leasePath)).toEqual([])
	})

	it('rejects cleanup before base import completion', async () => {
		const storage = filesystemIngestionStorage(root)
		await runPromise(storage.writeCampaignImportData!(request, [importedSource]))

		expect(
			await runPromise(flip(storage.cleanupCampaignImport!(campaignId, request.ingestionId)))
		).toMatchObject({
			operation: 'cleanupCampaignImport',
			cause: { name: 'IncompleteCampaignImportCleanupError' }
		})
		expect(
			await runPromise(storage.readCampaignImportData!(campaignId, request.ingestionId))
		).toEqual(request)
	})

	it('rejects cleanup after chronology commit is requested until committed completion exists', async () => {
		const storage = filesystemIngestionStorage(root)
		await runPromise(storage.writeCampaignImportData!(request, [importedSource]))
		await runPromise(
			storage.writeCampaignImportCompletion!({
				schemaVersion: 1,
				kind: 'campaign-import-completion',
				campaignId,
				ingestionId,
				documents: [],
				finalized: true
			})
		)
		await runPromise(
			storage.writeCampaignImportChronologyCommitData({
				schemaVersion: 1,
				kind: 'campaign-import-chronology-commit',
				campaignId,
				ingestionId,
				selectedChronologyIds: []
			})
		)

		expect(
			await runPromise(flip(storage.cleanupCampaignImport(campaignId, ingestionId)))
		).toMatchObject({
			operation: 'cleanupCampaignImport',
			cause: { name: 'IncompleteCampaignImportCleanupError' }
		})

		await runPromise(
			storage.writeCampaignImportChronologyCompletion({
				schemaVersion: 1,
				kind: 'campaign-import-chronology-completion',
				campaignId,
				ingestionId,
				updatedDocumentIds: [],
				finalized: true
			})
		)
		await expect(
			runPromise(storage.cleanupCampaignImport(campaignId, ingestionId))
		).resolves.toBeUndefined()
	})
})
