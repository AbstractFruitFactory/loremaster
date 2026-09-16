import { resolve } from 'node:path'
import type { AiProvider } from './ai/provider'
import { assistant as createAssistant } from './assistant'
import { campaign as createCampaign } from './campaign'
import { contextIndex as createContextIndex } from './context/indexing'
import { context as createContext } from './context'
import { sessionIngestion } from './ingestion'
import { filesystemIngestionStorage } from './ingestion/storage'
import * as campaignDb from './db/campaign'
import * as contextDb from './db/context'
import * as revisionDb from './db/revisions'
import * as timelineDb from './db/timeline'
import * as vaultDb from './db/vault'
import * as vectorDb from './db/vector'
import { lore as createLore } from './lore'
import { timeline as createTimeline } from './timeline'
import { vault as createVault } from './vault'
import { vaultRevision } from './vault/revisions'
import { filesystemRevisionStorage } from './vault/revisions/storage'
import { filesystemVaultStorage } from './vault/storage/filesystem'

const sessionAttributionInstruction =
	'Preserve epistemic attribution in every extracted claim. If information is presented as dialogue, testimony, belief, rumor, legend, hearsay, or a written source, keep that source in the normalized claim content. Never rewrite "Ilyra says X" as "X", "Nell believes or reports X" as "X", "a letter states X" as "X", or "a legend says X" as "X". Only state X directly as an objective world fact when the transcript itself establishes X authoritatively. The certainty field describes how directly the full attributed claim is supported by the evidence; explicit does not mean that an embedded proposition is objectively true.'

export const createServices = (ai: AiProvider) => {
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
	const vaultRoot = resolve('data/campaigns')
	const storage = filesystemVaultStorage(vaultRoot)
	const revisions = vaultRevision({
		db: revisionDb,
		revisions: filesystemRevisionStorage(vaultRoot),
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
		storage: filesystemIngestionStorage(vaultRoot),
		vault
	})

	const context = createContext({
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

	const assistant = createAssistant({
		ai: {
			generateAssistant: ai.generateAssistant,
			streamAssistant: ai.streamAssistant,
			model: ai.models.assistant
		},
		context
	})

	const lore = createLore({ vault })

	return { assistant, campaign, context, ingestion, lore, revisions, timeline, vault }
}
