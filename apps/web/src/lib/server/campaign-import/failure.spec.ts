import { describe, expect, it } from 'vitest'
import {
	CampaignImportReviewCommitConflictError,
	CampaignImportReviewLockBusyError
} from '@loremaster/core/server/ingestion/storage'
import { campaignImportCommitHttpError } from './failure'

describe('campaign import commit failure mapping', () => {
	it('maps a stale acknowledged review to conflict', () => {
		expect(
			campaignImportCommitHttpError({
				domain: 'ingestionStorage',
				operation: 'writeCampaignImportCommitData',
				cause: new CampaignImportReviewCommitConflictError('staleRevision')
			})
		).toEqual({
			status: 409,
			message: 'This review changed before committing. Reload and try again.'
		})
	})

	it('maps cross-process review lock contention to conflict', () => {
		expect(
			campaignImportCommitHttpError({
				domain: 'ingestionStorage',
				operation: 'writeCampaignImportCommitData',
				cause: new CampaignImportReviewLockBusyError()
			})
		).toMatchObject({ status: 409 })
	})
})
