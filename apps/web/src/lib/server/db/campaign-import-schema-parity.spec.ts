import { describe, expect, it } from 'vitest'
import * as coreSchema from '@loremaster/core/server/db/schema'
import * as webSchema from './schema.js'

describe('campaign import database schema parity', () => {
	it('re-exports the canonical core schema', () => {
		expect(webSchema.campaignImportClaimProvenance).toBe(coreSchema.campaignImportClaimProvenance)
		expect(webSchema.campaignImportChronologyProvenance).toBe(
			coreSchema.campaignImportChronologyProvenance
		)
		expect(webSchema.campaignImportSourceRevisions).toBe(coreSchema.campaignImportSourceRevisions)
		expect(webSchema.campaignImportAcceptedClaims).toBe(coreSchema.campaignImportAcceptedClaims)
	})
})
