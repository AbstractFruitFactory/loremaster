import { CampaignImportNotFoundError } from '@loremaster/core/server/ingestion/storage'
import { describe, expect, it } from 'vitest'
import { campaignImportNotFoundHttpError } from './http'

describe('campaign import HTTP error mapping', () => {
	it('maps only the typed campaign-import not-found error to 404', () => {
		const failure = {
			domain: 'ingestionStorage',
			operation: 'readCampaignImportLifecycleState',
			cause: new CampaignImportNotFoundError()
		}

		expect(campaignImportNotFoundHttpError(failure, 'Not found')).toEqual({
			status: 404,
			message: 'Not found'
		})
		expect(
			campaignImportNotFoundHttpError(
				{ ...failure, cause: new Error('database unavailable') },
				'Not found'
			)
		).toBeUndefined()
	})
})
