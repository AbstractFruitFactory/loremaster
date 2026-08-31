import { resolve } from 'node:path'
import { mockAiProvider } from './ai/providers/mock'
import { assistantOperations } from './assistant/operations'
import { campaignOperations } from './campaign/operations'
import { contextIndexOperations } from './context/indexing/operations'
import { contextOperations } from './context/operations'
import * as campaignDb from './db/campaign'
import * as contextDb from './db/context'
import * as timelineDb from './db/timeline'
import * as vaultDb from './db/vault'
import * as vectorDb from './db/vector'
import { loreOperations } from './lore/operations'
import { timelineOperations } from './timeline/operations'
import { filesystemVaultStorage } from './vault/storage/filesystem'
import { vaultOperations } from './vault/operations'

const aiModels = {
	assistant: 'mock-assistant-v1',
	campaignSummary: 'mock-text-v1',
	documentSummary: 'mock-text-v1',
	documentType: 'mock-document-type-v1',
	embeddings: 'mock-token-hash-v1'
}

export const campaign = campaignOperations({
	ai: {
		generateText: mockAiProvider.generateText,
		model: aiModels.campaignSummary
	},
	db: campaignDb
})

const contextIndex = contextIndexOperations({
	ai: {
		embedTexts: mockAiProvider.embedTexts,
		model: aiModels.embeddings
	},
	db: {
		...contextDb,
		...vectorDb
	}
})

export const timeline = timelineOperations({ db: timelineDb })

export const vault = vaultOperations({
	ai: {
		inferDocumentType: mockAiProvider.inferDocumentType,
		generateText: mockAiProvider.generateText,
		documentTypeModel: aiModels.documentType,
		summaryModel: aiModels.documentSummary
	},
	db: {
		getCampaignById: campaignDb.getById,
		...vaultDb
	},
	contextIndex,
	storage: filesystemVaultStorage(resolve('data/campaigns')),
	timeline
})

export const context = contextOperations({
	ai: {
		embedTexts: mockAiProvider.embedTexts,
		model: aiModels.embeddings
	},
	db: {
		...contextDb,
		...vaultDb,
		...vectorDb
	},
	timeline
})

export const assistant = assistantOperations({
	ai: {
		generateAssistant: mockAiProvider.generateAssistant,
		model: aiModels.assistant
	},
	context
})
export const lore = loreOperations({ vault })
