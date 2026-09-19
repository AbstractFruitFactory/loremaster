import { describe, expect, it } from 'vitest'
import { campaignImportStageLabels, campaignImportStoppedAt } from './workflow-status.js'

describe('campaign import workflow status copy', () => {
	it('formats failed stages with the shared human-readable label', () => {
		expect(campaignImportStageLabels['applying-mutations']).toBe('Writing campaign documents')
		expect(campaignImportStoppedAt('applying-mutations')).toBe(
			'Stopped while writing campaign documents.'
		)
		expect(campaignImportStoppedAt('applying-chronology-mutations')).toBe(
			'Stopped while updating event chronology.'
		)
	})
})
