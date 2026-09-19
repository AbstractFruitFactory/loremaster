import type { Failure } from '@loremaster/core/server/failure'
import {
	isCampaignImportReviewCommitConflict,
	isCampaignImportReviewLockBusy,
	isImmutableIngestionConflict
} from '@loremaster/core/server/ingestion/storage'

export const campaignImportCommitHttpError = (failure: Failure) => {
	if (isImmutableIngestionConflict(failure.cause)) {
		return {
			status: 409 as const,
			message: 'A different import selection is already being committed'
		}
	}
	if (isCampaignImportReviewCommitConflict(failure.cause)) {
		return {
			status: 409 as const,
			message: 'This review changed before committing. Reload and try again.'
		}
	}
	if (isCampaignImportReviewLockBusy(failure.cause)) {
		return {
			status: 409 as const,
			message: 'This review is being changed elsewhere. Try again.'
		}
	}
	return undefined
}
