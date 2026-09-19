import { error } from '@sveltejs/kit'
import { campaignImport } from '#lib/server/app.js'
import { logFailure } from '#lib/server/failure.js'
import { runCore } from './http.js'

export const recordCampaignImportChronologyDispatch = (campaignId: string, ingestionId: string) =>
	runCore(
		campaignImport.commitOperations.recordChronologyDispatch({
			schemaVersion: 1,
			kind: 'campaign-import-chronology-dispatch',
			campaignId,
			ingestionId,
			status: 'dispatched',
			updatedAt: new Date().toISOString()
		}),
		(failure) => {
			logFailure(failure)
			error(500, 'Unable to record chronology dispatch')
		}
	)
