import type { CampaignImportLifecycleStorageState } from '@loremaster/core/server/ingestion/types'
import {
	campaignImportWorkflowKinds,
	isActiveWorkflowLifecycle
} from '@loremaster/core/workflows/contracts'
import { deriveCampaignImportLifecycle, type CampaignImportWorkflowStatuses } from './lifecycle.js'

export const canRunCampaignImportCleanup = ({
	cleanupStarted,
	state,
	workflows
}: {
	cleanupStarted: boolean
	state?: CampaignImportLifecycleStorageState
	workflows: CampaignImportWorkflowStatuses
}) => {
	if (
		campaignImportWorkflowKinds.some((kind) => isActiveWorkflowLifecycle(workflows[kind].lifecycle))
	) {
		return false
	}
	if (cleanupStarted) return true
	return state ? deriveCampaignImportLifecycle(state, workflows).canFinish : false
}
