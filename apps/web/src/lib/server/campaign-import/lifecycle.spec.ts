import { describe, expect, it } from 'vitest'
import type {
	CampaignImportChronologyDraft,
	CampaignImportLifecycleStorageState
} from '@loremaster/core/server/ingestion/types'
import {
	campaignImportWorkflowDescriptors,
	campaignImportWorkflowKinds,
	type CampaignImportWorkflowKind,
	type WorkflowLifecycle
} from '@loremaster/core/workflows/contracts'
import { canRunCampaignImportCleanup } from './cleanup'
import { deriveCampaignImportLifecycle, type CampaignImportWorkflowStatuses } from './lifecycle'

const campaignId = '40000000-0000-5000-8000-000000000001'
const ingestionId = '30000000-0000-5000-8000-000000000001'

const state = (
	overrides: Partial<CampaignImportLifecycleStorageState> = {}
): CampaignImportLifecycleStorageState => ({
	request: {
		schemaVersion: 1,
		kind: 'campaign-import',
		campaignId,
		ingestionId,
		createdAt: '2026-09-19T08:00:00.000Z',
		sources: []
	},
	commitRequested: false,
	...overrides
})

const statuses = (
	overrides: Partial<Record<CampaignImportWorkflowKind, WorkflowLifecycle>> = {}
): CampaignImportWorkflowStatuses =>
	Object.fromEntries(
		campaignImportWorkflowKinds.map((kind) => {
			const lifecycle = overrides[kind] ?? 'not-started'
			return [
				kind,
				{
					campaignId,
					ingestionId,
					workflowId: campaignImportWorkflowDescriptors[kind].workflowId(campaignId, ingestionId),
					lifecycle,
					refreshDocuments: false,
					retryable:
						lifecycle === 'not-started' || lifecycle === 'failed' || lifecycle === 'cancelled'
				}
			]
		})
	) as CampaignImportWorkflowStatuses

const baseCompletion = {
	schemaVersion: 1 as const,
	kind: 'campaign-import-completion' as const,
	campaignId,
	ingestionId,
	documents: [],
	finalized: true
}

const chronologyDraft = (relationshipCount: number): CampaignImportChronologyDraft => ({
	schemaVersion: 1,
	kind: 'campaign-import-chronology',
	campaignId,
	ingestionId,
	createdAt: '2026-09-19T08:00:00.000Z',
	chronology: Array.from({ length: relationshipCount }, (_, index) => ({
		chronologyId: `chronology-${index}`,
		relation: 'before',
		source: { eventId: `event-${index}`, title: `Event ${index}`, source: 'existing' },
		target: {
			eventId: `event-${index + 1}`,
			title: `Event ${index + 1}`,
			source: 'existing'
		},
		certainty: 'explicit',
		reason: 'Imported evidence establishes the order.',
		selected: true,
		supportingClaimIds: [],
		evidence: []
	})),
	chronologyCoverage: [],
	warnings: []
})

const chronologyCommitData = {
	schemaVersion: 1 as const,
	kind: 'campaign-import-chronology-commit' as const,
	campaignId,
	ingestionId,
	selectedChronologyIds: []
}

describe('campaign import lifecycle', () => {
	it('keeps a base-completed import resumable while chronology is pending', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDispatch: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-dispatch',
					campaignId,
					ingestionId,
					status: 'dispatched',
					updatedAt: '2026-09-19T08:10:00.000Z'
				}
			}),
			statuses({ commit: 'succeeded', 'chronology-analysis': 'queued' })
		)

		expect(lifecycle).toMatchObject({
			phase: 'chronology-analyzing',
			canFinish: false,
			finishDisabledReason: 'workflow-active'
		})
		expect(lifecycle.baseCompletion).toEqual(baseCompletion)
	})

	it('allows finishing without chronology after dispatch failure', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDispatch: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-dispatch',
					campaignId,
					ingestionId,
					status: 'failed',
					updatedAt: '2026-09-19T08:10:00.000Z',
					error: { code: 'chronology.dispatchFailed', message: 'Dispatch failed.' }
				}
			}),
			statuses({ commit: 'succeeded' })
		)

		expect(lifecycle).toMatchObject({
			phase: 'failed',
			chronologyDispatchFailed: true,
			canFinish: true
		})
		expect(lifecycle).not.toHaveProperty('finishDisabledReason')
		expect(lifecycle.workflows['chronology-analysis'].retryable).toBe(true)
	})

	it.each(['queued', 'running', 'succeeded'] as const)(
		'ignores a stale dispatch failure after chronology is %s',
		(chronologyLifecycle) => {
			const lifecycle = deriveCampaignImportLifecycle(
				state({
					commitRequested: true,
					completion: baseCompletion,
					chronologyDispatch: {
						schemaVersion: 1,
						kind: 'campaign-import-chronology-dispatch',
						campaignId,
						ingestionId,
						status: 'failed',
						updatedAt: '2026-09-19T08:10:00.000Z'
					}
				}),
				statuses({
					commit: 'succeeded',
					'chronology-analysis': chronologyLifecycle
				})
			)

			expect(lifecycle.chronologyDispatchFailed).toBe(false)
			expect(lifecycle.phase).toBe('chronology-analyzing')
		}
	)

	it('lets persisted chronology supersede a failed dispatch marker', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDispatch: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-dispatch',
					campaignId,
					ingestionId,
					status: 'failed',
					updatedAt: '2026-09-19T08:10:00.000Z'
				},
				chronologyDraft: chronologyDraft(1)
			}),
			statuses({
				commit: 'succeeded',
				'chronology-analysis': 'succeeded'
			})
		)

		expect(lifecycle).toMatchObject({
			chronologyDispatchFailed: false,
			phase: 'chronology-review',
			canFinish: true
		})
	})

	it('rejects cleanup for active and pending chronology commits', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(1),
				chronologyCommitData
			}),
			statuses({
				commit: 'succeeded',
				'chronology-analysis': 'succeeded',
				'chronology-commit': 'running'
			})
		)

		expect(lifecycle).toMatchObject({
			phase: 'chronology-committing',
			canFinish: false,
			finishDisabledReason: 'workflow-active'
		})
	})

	it('allows cleanup only after storage completion and terminal success are observed', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(0),
				chronologyCompletion: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-no-relations',
					campaignId,
					ingestionId,
					updatedDocumentIds: [],
					finalized: true
				}
			}),
			statuses({ commit: 'succeeded', 'chronology-analysis': 'succeeded' })
		)

		expect(lifecycle).toMatchObject({
			phase: 'ready-to-finish',
			canFinish: true,
			chronologyDispatchFailed: false
		})
	})

	it('marks a durable no-relations outcome ready to finish without a commit', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(0),
				chronologyCompletion: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-no-relations',
					campaignId,
					ingestionId,
					updatedDocumentIds: [],
					finalized: true
				}
			}),
			statuses({ commit: 'succeeded', 'chronology-analysis': 'succeeded' })
		)

		expect(lifecycle).toMatchObject({ phase: 'ready-to-finish', canFinish: true })
		expect(lifecycle).not.toHaveProperty('finishDisabledReason')
	})

	it('does not infer completion from an empty draft without its durable outcome', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(0)
			}),
			statuses({ commit: 'succeeded', 'chronology-analysis': 'succeeded' })
		)

		expect(lifecycle).toMatchObject({
			phase: 'chronology-analyzing',
			canFinish: false,
			finishDisabledReason: 'chronology-analysis-incomplete'
		})
	})

	it('allows finishing from a nonempty chronology review without committing it', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(1)
			}),
			statuses({ commit: 'succeeded', 'chronology-analysis': 'succeeded' })
		)

		expect(lifecycle).toMatchObject({ phase: 'chronology-review', canFinish: true })
		expect(lifecycle).not.toHaveProperty('finishDisabledReason')
	})

	it.each(['failed', 'cancelled'] as const)(
		'allows finishing after chronology analysis is %s',
		(terminalFailure) => {
			const lifecycle = deriveCampaignImportLifecycle(
				state({ commitRequested: true, completion: baseCompletion }),
				statuses({
					commit: 'succeeded',
					'chronology-analysis': terminalFailure
				})
			)

			expect(lifecycle).toMatchObject({ phase: 'failed', canFinish: true })
			expect(lifecycle).not.toHaveProperty('finishDisabledReason')
		}
	)

	it.each(['failed', 'cancelled'] as const)(
		'blocks finishing and requires retry after a requested chronology commit is %s',
		(terminalFailure) => {
			const lifecycle = deriveCampaignImportLifecycle(
				state({
					commitRequested: true,
					completion: baseCompletion,
					chronologyDraft: chronologyDraft(1),
					chronologyCommitData
				}),
				statuses({
					commit: 'succeeded',
					'chronology-analysis': 'succeeded',
					'chronology-commit': terminalFailure
				})
			)

			expect(lifecycle).toMatchObject({
				phase: 'failed',
				canFinish: false,
				finishDisabledReason: 'chronology-commit-failed'
			})
		}
	)

	it('requires a completion marker after a successful chronology commit', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(1),
				chronologyCommitData
			}),
			statuses({
				commit: 'succeeded',
				'chronology-analysis': 'succeeded',
				'chronology-commit': 'succeeded'
			})
		)

		expect(lifecycle).toMatchObject({
			phase: 'chronology-committing',
			canFinish: false,
			finishDisabledReason: 'chronology-commit-incomplete'
		})
	})

	it('blocks a requested chronology commit that has not started', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(1),
				chronologyCommitData
			}),
			statuses({ commit: 'succeeded', 'chronology-analysis': 'succeeded' })
		)

		expect(lifecycle).toMatchObject({
			phase: 'chronology-committing',
			canFinish: false,
			finishDisabledReason: 'chronology-commit-incomplete'
		})
	})

	it('allows finishing a successful chronology commit with its completion marker', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({
				commitRequested: true,
				completion: baseCompletion,
				chronologyDraft: chronologyDraft(1),
				chronologyCommitData,
				chronologyCompletion: {
					schemaVersion: 1,
					kind: 'campaign-import-chronology-completion',
					campaignId,
					ingestionId,
					updatedDocumentIds: ['event-1'],
					finalized: true
				}
			}),
			statuses({
				commit: 'succeeded',
				'chronology-analysis': 'succeeded',
				'chronology-commit': 'succeeded'
			})
		)

		expect(lifecycle).toMatchObject({ phase: 'ready-to-finish', canFinish: true })
	})

	it('blocks finishing before base completion even when chronology is terminal', () => {
		const lifecycle = deriveCampaignImportLifecycle(
			state({ commitRequested: true }),
			statuses({ commit: 'failed', 'chronology-analysis': 'failed' })
		)

		expect(lifecycle).toMatchObject({
			phase: 'failed',
			canFinish: false,
			finishDisabledReason: 'base-import-incomplete'
		})
	})

	it('blocks previously verified cleanup while any workflow is active', () => {
		expect(
			canRunCampaignImportCleanup({
				cleanupStarted: true,
				workflows: statuses({
					commit: 'succeeded',
					'chronology-analysis': 'running'
				})
			})
		).toBe(false)
	})
})
