import { resolve } from 'node:path'
import * as ai from './ai/generate'
import { campaignOperations } from './campaign/operations'
import * as campaignDb from './db/campaign'
import * as vaultDb from './db/vault'
import { filesystemVaultStorage } from './vault/storage/filesystem'
import { vaultOperations } from './vault/operations'

export const campaign = campaignOperations({
	ai,
	db: campaignDb
})

export const vault = vaultOperations({
	db: {
		getCampaignById: campaignDb.getById,
		...vaultDb
	},
	storage: filesystemVaultStorage(resolve('data/campaigns'))
})
