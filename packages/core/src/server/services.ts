import { resolve } from 'node:path'
import type { AiProvider } from './ai/provider.js'
import { assistant as createAssistant } from './assistant/index.js'
import { campaign as createCampaign } from './campaign/index.js'
import { candidateRetrieval } from './context/candidates.js'
import { contextIndex as createContextIndex } from './context/indexing/index.js'
import { context as createContext } from './context/index.js'
import { ingestionContext } from './ingestion/context.js'
import { campaignImport as createCampaignImport, sessionIngestion } from './ingestion/index.js'
import { filesystemStorageAdapter } from './storage/filesystem.js'
import { supabaseStorageAdapter, type SupabaseStorageConfig } from './storage/supabase.js'
import { campaignImportHistoryRepository } from './db/campaign-import.js'
import * as campaignDb from './db/campaign.js'
import * as contextDb from './db/context.js'
import { initializeDatabase } from './db/index.js'
import * as revisionDb from './db/revisions.js'
import * as timelineDb from './db/timeline.js'
import * as vaultDb from './db/vault.js'
import * as vectorDb from './db/vector.js'
import { lore as createLore } from './lore/index.js'
import { timeline as createTimeline } from './timeline/index.js'
import { vault as createVault } from './vault/index.js'
import { vaultRevision } from './vault/revisions/index.js'

const sessionAttributionInstruction =
	'Preserve epistemic attribution in every extracted claim. If information is presented as dialogue, testimony, belief, rumor, legend, hearsay, or a written source, keep that source in the normalized claim content. Never rewrite "Ilyra says X" as "X", "Nell believes or reports X" as "X", "a letter states X" as "X", or "a legend says X" as "X". Only state X directly as an objective world fact when the transcript itself establishes X authoritatively. The certainty field describes how directly the full attributed claim is supported by the evidence; explicit does not mean that an embedded proposition is objectively true.'

export const createServices = (
	ai: AiProvider,
	{
		databaseUrl,
		databaseMaxConnections,
		vaultRoot = 'data/campaigns',
		supabaseStorage
	}: {
		databaseUrl: string
		databaseMaxConnections?: number
		vaultRoot?: string
		supabaseStorage?: SupabaseStorageConfig
	}
) => {
	initializeDatabase(databaseUrl, { maxConnections: databaseMaxConnections })
	vectorDb.initializeVectorStore(databaseUrl)
	const campaign = createCampaign({
		ai: {
			generateText: ai.generateText,
			model: ai.models.campaignSummary
		},
		db: campaignDb
	})

	const contextIndex = createContextIndex({
		ai: {
			embedTexts: ai.embedTexts,
			model: ai.models.embeddings
		},
		db: {
			...contextDb,
			...vectorDb
		}
	})

	const timeline = createTimeline({ db: timelineDb })
	const resolvedVaultRoot = resolve(vaultRoot)
	const storageAdapter = supabaseStorage
		? supabaseStorageAdapter(supabaseStorage)
		: filesystemStorageAdapter(resolvedVaultRoot)
	const storage = storageAdapter.vault
	const revisions = vaultRevision({
		db: revisionDb,
		revisions: storageAdapter.revisions,
		vault: storage
	})

	const vault = createVault({
		ai: {
			inferDocumentType: ai.inferDocumentType,
			generateText: ai.generateText,
			generateRelationshipLinks: ai.generateRelationshipLinks,
			documentTypeModel: ai.models.documentType,
			summaryModel: ai.models.documentSummary,
			relationshipModel: ai.models.relationshipLinks
		},
		db: {
			getCampaignById: campaignDb.getById,
			...vaultDb
		},
		contextIndex,
		revisions,
		storage,
		timeline
	})

	const candidates = candidateRetrieval({
		ai: {
			embedTexts: ai.embedTexts,
			model: ai.models.embeddings
		},
		db: {
			...contextDb,
			...vaultDb,
			...vectorDb
		}
	})

	const context = createContext({
		candidates,
		timeline
	})

	const analysisContext = ingestionContext({
		candidates,
		timeline,
		hydrateDocuments: vault.getDocumentsByIds
	})

	const ingestionStorage = storageAdapter.ingestion
	const ingestion = sessionIngestion({
		ai: {
			analyzeSessionChunk: (input) =>
				ai.analyzeSessionChunk({
					...input,
					system: `${input.system}\n\n${sessionAttributionInstruction}`
				}),
			validateSessionClaims: ai.validateSessionClaims,
			repairSessionClaimEvidence: ai.repairSessionClaimEvidence,
			resolveSessionEntities: ai.resolveSessionEntities,
			auditSessionEvents: ai.auditSessionEvents,
			inferSessionChronology: ai.inferSessionChronology,
			analysisModel: ai.models.sessionAnalysis
		},
		storage: ingestionStorage,
		retrieveAnalysisDocuments: analysisContext.retrieveDocuments,
		vault
	})
	const campaignImport = createCampaignImport({
		ai: {
			analyzeSessionChunk: ai.analyzeSessionChunk,
			validateSessionClaims: ai.validateSessionClaims,
			repairSessionClaimEvidence: ai.repairSessionClaimEvidence,
			inferCampaignImportChronology: ai.inferCampaignImportChronology,
			analysisModel: ai.models.sessionAnalysis
		},
		history: campaignImportHistoryRepository,
		storage: ingestionStorage,
		retrieveAnalysisDocuments: analysisContext.retrieveDocuments,
		vault
	})

	const assistant = createAssistant({
		ai: {
			generateAssistant: ai.generateAssistant,
			streamAssistant: ai.streamAssistant,
			model: ai.models.assistant
		},
		context
	})

	const lore = createLore({ vault })

	return {
		assistant,
		campaign,
		campaignImport,
		context,
		ingestion,
		lore,
		revisions,
		timeline,
		vault
	}
}
