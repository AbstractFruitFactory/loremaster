import { resolve } from 'node:path'
import type { AiProvider } from './ai/provider'
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
import { vaultOperations } from './vault/operations'
import { filesystemVaultStorage } from './vault/storage/filesystem'

export const createServices = (ai: AiProvider) => {
	const campaign = campaignOperations({
		ai: {
			generateText: ai.generateText,
			model: ai.models.campaignSummary
		},
		db: campaignDb
	})

	const contextIndex = contextIndexOperations({
		ai: {
			embedTexts: ai.embedTexts,
			model: ai.models.embeddings
		},
		db: {
			...contextDb,
			...vectorDb
		}
	})

	const timeline = timelineOperations({ db: timelineDb })

	const vault = vaultOperations({
		ai: {
			inferDocumentType: ai.inferDocumentType,
			generateText: ai.generateText,
			documentTypeModel: ai.models.documentType,
			summaryModel: ai.models.documentSummary
		},
		db: {
			getCampaignById: campaignDb.getById,
			...vaultDb
		},
		contextIndex,
		storage: filesystemVaultStorage(resolve('data/campaigns')),
		timeline
	})

	const context = contextOperations({
		ai: {
			embedTexts: ai.embedTexts,
			model: ai.models.embeddings
		},
		db: {
			...contextDb,
			...vaultDb,
			...vectorDb
		},
		timeline
	})

	const assistant = assistantOperations({
		ai: {
			generateAssistant: ai.generateAssistant,
			streamAssistant: ai.streamAssistant,
			model: ai.models.assistant
		},
		context
	})

	const lore = loreOperations({ vault })

	return { assistant, campaign, context, lore, timeline, vault }
}
