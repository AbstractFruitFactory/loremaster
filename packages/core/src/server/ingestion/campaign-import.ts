import { campaignImportAnalysis, type CampaignImportDependencies } from './import-analysis.js'
import { campaignImportChronology } from './import-chronology.js'
import { campaignImportCommit } from './import-commit.js'
import { campaignImportLifecycle } from './import-lifecycle.js'

export const campaignImport = (dependencies: CampaignImportDependencies) => {
	const analysisOperations = campaignImportAnalysis(dependencies)
	const commitOperations = campaignImportCommit(dependencies)
	const lifecycleOperations = campaignImportLifecycle(dependencies)
	const chronologyOperations = campaignImportChronology(dependencies)
	return {
		...analysisOperations,
		commitOperations: {
			...commitOperations,
			...lifecycleOperations
		},
		chronology: chronologyOperations
	}
}
