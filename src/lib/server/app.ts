import * as ai from './ai/generate'
import { campaignOperations } from './campaign/operations'
import * as campaignDb from './db/campaign'

export const campaign = campaignOperations({
	ai,
	db: campaignDb
})
