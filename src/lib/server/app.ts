import { resolve } from 'node:path'
import * as documentAi from './ai/infer-document-type'
import * as embeddings from './ai/embeddings'
import * as ai from './ai/generate'
import * as assistantAi from './ai/assistant'
import { assistantOperations } from './assistant/operations'
import { campaignOperations } from './campaign/operations'
import { contextIndexOperations } from './context/indexing/operations'
import { contextOperations } from './context/operations'
import * as campaignDb from './db/campaign'
import * as contextDb from './db/context'
import * as vaultDb from './db/vault'
import * as vectorDb from './db/vector'
import { filesystemVaultStorage } from './vault/storage/filesystem'
import { vaultOperations } from './vault/operations'

export const campaign = campaignOperations({
	ai,
	db: campaignDb
})

const contextIndex = contextIndexOperations({
	ai: {
		embedTexts: embeddings.embedTexts,
		model: embeddings.EMBEDDING_MODEL
	},
	db: {
		...contextDb,
		...vectorDb
	}
})

export const vault = vaultOperations({
	ai: documentAi,
	db: {
		getCampaignById: campaignDb.getById,
		...vaultDb
	},
	contextIndex,
	storage: filesystemVaultStorage(resolve('data/campaigns'))
})

export const context = contextOperations({
	ai: {
		embedTexts: embeddings.embedTexts,
		model: embeddings.EMBEDDING_MODEL
	},
	db: {
		...contextDb,
		...vaultDb,
		...vectorDb
	}
})

export const assistant = assistantOperations({ ai: assistantAi, context })
