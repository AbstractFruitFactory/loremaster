import {
	MAX_CAMPAIGN_IMPORT_BYTES,
	MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS,
	MAX_CAMPAIGN_IMPORT_SOURCE_BYTES,
	MAX_CAMPAIGN_IMPORT_SOURCES
} from '@loremaster/core/server/ingestion/types'
import { describe, expect, it } from 'vitest'
import {
	MAX_CAMPAIGN_IMPORT_BYTES as webBytes,
	MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS as webSelections,
	MAX_CAMPAIGN_IMPORT_SOURCE_BYTES as webSourceBytes,
	MAX_CAMPAIGN_IMPORT_SOURCES as webSources
} from './import-limits.js'

describe('campaign import limits', () => {
	it('shares the canonical core limits with the UI', () => {
		expect(webSources).toBe(MAX_CAMPAIGN_IMPORT_SOURCES)
		expect(webSourceBytes).toBe(MAX_CAMPAIGN_IMPORT_SOURCE_BYTES)
		expect(webBytes).toBe(MAX_CAMPAIGN_IMPORT_BYTES)
		expect(webSelections).toBe(MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS)
		expect(webSources).toBe(50)
		expect(webSourceBytes).toBe(2 * 1024 * 1024)
		expect(webBytes).toBe(10 * 1024 * 1024)
		expect(webSelections).toBe(500)
	})
})
