import { sql } from 'drizzle-orm'
import {
	check,
	customType,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
	vector
} from 'drizzle-orm/pg-core'
import { documentTypes } from '../../document'
import { EMBEDDING_DIMENSIONS } from '../ai/provider'
import type { LoreSource } from '../assistant/types'
import { revisionOperations, revisionSources } from '../vault/revisions/types'

const tsvector = customType<{ data: string }>({
	dataType: () => 'tsvector'
})

export const campaigns = pgTable('campaigns', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	description: text('description').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
})

export const vaultDocuments = pgTable(
	'vault_documents',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		documentId: text('document_id').notNull(),
		path: text('path').notNull(),
		title: text('title').notNull(),
		type: text('type', { enum: documentTypes }).notNull(),
		summary: text('summary').notNull().default(''),
		indexedAt: timestamp('indexed_at', { withTimezone: true, mode: 'string' })
			.notNull()
			.defaultNow()
	},
	(table) => [
		uniqueIndex('vault_documents_campaign_document_id_unique').on(
			table.campaignId,
			table.documentId
		),
		uniqueIndex('vault_documents_campaign_path_unique').on(table.campaignId, table.path),
		index('vault_documents_campaign_id_index').on(table.campaignId)
	]
)

export const vaultRevisions = pgTable(
	'vault_revisions',
	{
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		revisionId: text('revision_id').notNull(),
		previousRevisionId: text('previous_revision_id'),
		documentId: text('document_id').notNull(),
		path: text('path').notNull(),
		operation: text('operation', { enum: revisionOperations }).notNull(),
		source: text('source', { enum: revisionSources }).notNull(),
		relatedSessionId: text('related_session_id'),
		ingestionId: text('ingestion_id'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
		beforeHash: text('before_hash'),
		afterHash: text('after_hash'),
		changeSummary: text('change_summary')
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.revisionId],
			name: 'vault_revisions_campaign_revision_pk'
		}),
		index('vault_revisions_campaign_document_created_index').on(
			table.campaignId,
			table.documentId,
			table.createdAt
		)
	]
)

export const vaultRevisionHeads = pgTable(
	'vault_revision_heads',
	{
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		documentId: text('document_id').notNull(),
		revisionId: text('revision_id').notNull(),
		path: text('path').notNull(),
		sourceHash: text('source_hash')
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.documentId],
			name: 'vault_revision_heads_campaign_document_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.revisionId],
			foreignColumns: [vaultRevisions.campaignId, vaultRevisions.revisionId],
			name: 'vault_revision_heads_campaign_revision_fk'
		}).onDelete('cascade'),
		index('vault_revision_heads_campaign_index').on(table.campaignId)
	]
)

export const vaultLinks = pgTable(
	'vault_links',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		sourceDocumentId: text('source_document_id').notNull(),
		targetName: text('target_name').notNull(),
		targetDocumentId: text('target_document_id')
	},
	(table) => [
		foreignKey({
			columns: [table.campaignId, table.targetDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'vault_links_campaign_target_document_fk'
		}),
		index('vault_links_campaign_source_index').on(table.campaignId, table.sourceDocumentId),
		index('vault_links_campaign_target_index').on(table.campaignId, table.targetDocumentId)
	]
)

export const vaultRelationshipLinks = pgTable(
	'vault_relationship_links',
	{
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		sourceDocumentId: text('source_document_id').notNull(),
		targetDocumentId: text('target_document_id').notNull(),
		relationship: varchar('relationship', { length: 48 }).notNull()
	},
	(table) => [
		primaryKey({
			columns: [
				table.campaignId,
				table.sourceDocumentId,
				table.targetDocumentId,
				table.relationship
			],
			name: 'vault_relationship_links_campaign_source_target_relationship_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.sourceDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'vault_relationship_links_campaign_source_document_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.targetDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'vault_relationship_links_campaign_target_document_fk'
		}).onDelete('cascade'),
		check(
			'vault_relationship_links_different_documents_check',
			sql`${table.sourceDocumentId} <> ${table.targetDocumentId}`
		),
		index('vault_relationship_links_campaign_source_index').on(
			table.campaignId,
			table.sourceDocumentId
		),
		index('vault_relationship_links_campaign_target_index').on(
			table.campaignId,
			table.targetDocumentId
		)
	]
)

export const eventChronologyEdges = pgTable(
	'event_chronology_edges',
	{
		campaignId: uuid('campaign_id').notNull(),
		beforeDocumentId: text('before_document_id').notNull(),
		afterDocumentId: text('after_document_id').notNull()
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.beforeDocumentId, table.afterDocumentId],
			name: 'event_chronology_edges_campaign_before_after_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.beforeDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'event_chronology_edges_campaign_before_document_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.afterDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'event_chronology_edges_campaign_after_document_fk'
		}).onDelete('cascade'),
		check(
			'event_chronology_edges_different_documents_check',
			sql`${table.beforeDocumentId} <> ${table.afterDocumentId}`
		),
		index('event_chronology_edges_campaign_before_index').on(
			table.campaignId,
			table.beforeDocumentId
		),
		index('event_chronology_edges_campaign_after_index').on(table.campaignId, table.afterDocumentId)
	]
)

export const eventDuringEdges = pgTable(
	'event_during_edges',
	{
		campaignId: uuid('campaign_id').notNull(),
		eventDocumentId: text('event_document_id').notNull(),
		periodDocumentId: text('period_document_id').notNull()
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.eventDocumentId, table.periodDocumentId],
			name: 'event_during_edges_campaign_event_period_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.eventDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'event_during_edges_campaign_event_document_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.periodDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'event_during_edges_campaign_period_document_fk'
		}).onDelete('cascade'),
		check(
			'event_during_edges_different_documents_check',
			sql`${table.eventDocumentId} <> ${table.periodDocumentId}`
		),
		index('event_during_edges_campaign_event_index').on(table.campaignId, table.eventDocumentId),
		index('event_during_edges_campaign_period_index').on(table.campaignId, table.periodDocumentId)
	]
)

export const contextFragments = pgTable(
	'context_fragments',
	{
		id: text('id').notNull(),
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		documentId: text('document_id').notNull(),
		title: text('title').notNull(),
		aliases: text('aliases')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		aliasesText: text('aliases_text').notNull().default(''),
		documentType: text('document_type', { enum: documentTypes }).notNull(),
		heading: text('heading'),
		content: text('content').notNull(),
		position: integer('position').notNull(),
		contentHash: text('content_hash').notNull(),
		searchVector: tsvector('search_vector')
			.generatedAlwaysAs(
				sql`
					setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
					setweight(to_tsvector('simple', coalesce(aliases_text, '')), 'B') ||
					setweight(to_tsvector('simple', coalesce(heading, '')), 'C') ||
					setweight(to_tsvector('simple', coalesce(content, '')), 'D')
				`
			)
			.notNull(),
		indexedAt: timestamp('indexed_at', { withTimezone: true, mode: 'string' })
			.notNull()
			.defaultNow()
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.id],
			name: 'context_fragments_campaign_id_fragment_id_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.documentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'context_fragments_campaign_document_fk'
		}).onDelete('cascade'),
		uniqueIndex('context_fragments_campaign_document_position_unique').on(
			table.campaignId,
			table.documentId,
			table.position
		),
		index('context_fragments_campaign_document_index').on(table.campaignId, table.documentId),
		index('context_fragments_search_vector_index').using('gin', table.searchVector)
	]
)

export const contextDocumentNames = pgTable(
	'context_document_names',
	{
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		documentId: text('document_id').notNull(),
		normalizedName: text('normalized_name').notNull()
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.documentId, table.normalizedName],
			name: 'context_document_names_campaign_document_name_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.documentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'context_document_names_campaign_document_fk'
		}).onDelete('cascade'),
		index('context_document_names_campaign_name_index').on(table.campaignId, table.normalizedName)
	]
)

export const contextEmbeddingCache = pgTable(
	'context_embedding_cache',
	{
		model: text('model').notNull(),
		contentHash: text('content_hash').notNull(),
		embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
			.notNull()
			.defaultNow()
	},
	(table) => [
		primaryKey({
			columns: [table.model, table.contentHash],
			name: 'context_embedding_cache_model_content_hash_pk'
		})
	]
)

export const vaultFragmentEmbeddings = pgTable(
	'vault_fragment_embeddings',
	{
		id: serial('id').primaryKey(),
		vectorId: text('vector_id').notNull(),
		embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
		metadata: jsonb('metadata').notNull().default({}),
		namespace: varchar('namespace', { length: 255 }).notNull().default('default')
	},
	(table) => [
		uniqueIndex('vault_fragment_embeddings_namespace_vector_id_unique').on(
			table.namespace,
			table.vectorId
		)
	]
)

const conversationRoles = ['user', 'assistant'] as const

export const conversationMessages = pgTable(
	'conversation_messages',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		role: text('role', { enum: conversationRoles }).notNull(),
		content: text('content').notNull(),
		sources: jsonb('sources').$type<LoreSource[]>().notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
			.notNull()
			.defaultNow()
	},
	(table) => [
		index('conversation_messages_campaign_created_index').on(table.campaignId, table.createdAt)
	]
)

export const campaignImportSourceRevisions = pgTable(
	'campaign_import_source_revisions',
	{
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		sourceId: uuid('source_id').notNull(),
		sourceRevisionId: uuid('source_revision_id').notNull(),
		displayName: text('display_name').notNull(),
		title: text('title').notNull(),
		mediaType: text('media_type', { enum: ['text/markdown', 'text/plain'] }).notNull(),
		contentHash: text('content_hash').notNull(),
		byteLength: integer('byte_length').notNull(),
		ingestionId: text('ingestion_id').notNull(),
		committedAt: timestamp('committed_at', { withTimezone: true, mode: 'string' })
			.notNull()
			.defaultNow()
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.sourceId, table.sourceRevisionId],
			name: 'campaign_import_source_revisions_pk'
		}),
		uniqueIndex('campaign_import_source_revisions_hash_unique').on(
			table.campaignId,
			table.sourceId,
			table.contentHash
		),
		index('campaign_import_source_revisions_source_index').on(table.campaignId, table.sourceId)
	]
)

export const campaignImportAcceptedClaims = pgTable(
	'campaign_import_accepted_claims',
	{
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		claimFingerprint: text('claim_fingerprint').notNull(),
		kind: text('kind').notNull(),
		eventTitle: text('event_title'),
		content: text('content').notNull(),
		entityReferences: jsonb('entity_references').notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' })
			.notNull()
			.defaultNow()
	},
	(table) => [
		primaryKey({
			columns: [table.campaignId, table.claimFingerprint],
			name: 'campaign_import_accepted_claims_pk'
		})
	]
)

export const campaignImportClaimProvenance = pgTable(
	'campaign_import_claim_provenance',
	{
		campaignId: uuid('campaign_id').notNull(),
		claimFingerprint: text('claim_fingerprint').notNull(),
		sourceId: uuid('source_id').notNull(),
		sourceRevisionId: uuid('source_revision_id').notNull(),
		documentId: text('document_id').notNull(),
		vaultRevisionId: text('vault_revision_id').notNull(),
		excerpt: text('excerpt').notNull(),
		startStringIndex: integer('start_string_index').notNull(),
		endStringIndex: integer('end_string_index').notNull(),
		startLine: integer('start_line').notNull(),
		endLine: integer('end_line').notNull()
	},
	(table) => [
		primaryKey({
			columns: [
				table.campaignId,
				table.claimFingerprint,
				table.sourceId,
				table.sourceRevisionId,
				table.documentId,
				table.vaultRevisionId,
				table.startStringIndex,
				table.endStringIndex
			],
			name: 'campaign_import_claim_provenance_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.claimFingerprint],
			foreignColumns: [
				campaignImportAcceptedClaims.campaignId,
				campaignImportAcceptedClaims.claimFingerprint
			],
			name: 'campaign_import_claim_provenance_claim_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.sourceId, table.sourceRevisionId],
			foreignColumns: [
				campaignImportSourceRevisions.campaignId,
				campaignImportSourceRevisions.sourceId,
				campaignImportSourceRevisions.sourceRevisionId
			],
			name: 'campaign_import_claim_provenance_source_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.documentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'campaign_import_claim_provenance_document_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.vaultRevisionId],
			foreignColumns: [vaultRevisions.campaignId, vaultRevisions.revisionId],
			name: 'campaign_import_claim_provenance_revision_fk'
		}).onDelete('cascade'),
		index('campaign_import_claim_provenance_source_index').on(
			table.campaignId,
			table.sourceId,
			table.sourceRevisionId
		),
		index('campaign_import_claim_provenance_document_index').on(table.campaignId, table.documentId)
	]
)

export const campaignImportChronologyProvenance = pgTable(
	'campaign_import_chronology_provenance',
	{
		campaignId: uuid('campaign_id').notNull(),
		ingestionId: text('ingestion_id').notNull(),
		chronologyId: uuid('chronology_id').notNull(),
		relation: text('relation', { enum: ['before', 'during'] }).notNull(),
		sourceEventId: text('source_event_id').notNull(),
		targetEventId: text('target_event_id').notNull(),
		affectedDocumentId: text('affected_document_id').notNull(),
		vaultRevisionId: text('vault_revision_id').notNull(),
		claimId: uuid('claim_id').notNull(),
		claimFingerprint: text('claim_fingerprint').notNull(),
		sourceId: uuid('source_id').notNull(),
		sourceRevisionId: uuid('source_revision_id').notNull(),
		excerpt: text('excerpt').notNull(),
		startStringIndex: integer('start_string_index').notNull(),
		endStringIndex: integer('end_string_index').notNull(),
		startLine: integer('start_line').notNull(),
		endLine: integer('end_line').notNull()
	},
	(table) => [
		primaryKey({
			columns: [
				table.campaignId,
				table.ingestionId,
				table.chronologyId,
				table.affectedDocumentId,
				table.vaultRevisionId,
				table.claimId,
				table.sourceId,
				table.sourceRevisionId,
				table.startStringIndex,
				table.endStringIndex
			],
			name: 'campaign_import_chronology_provenance_pk'
		}),
		foreignKey({
			columns: [table.campaignId, table.claimFingerprint],
			foreignColumns: [
				campaignImportAcceptedClaims.campaignId,
				campaignImportAcceptedClaims.claimFingerprint
			],
			name: 'campaign_import_chronology_provenance_claim_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.sourceId, table.sourceRevisionId],
			foreignColumns: [
				campaignImportSourceRevisions.campaignId,
				campaignImportSourceRevisions.sourceId,
				campaignImportSourceRevisions.sourceRevisionId
			],
			name: 'campaign_import_chronology_provenance_source_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.affectedDocumentId],
			foreignColumns: [vaultDocuments.campaignId, vaultDocuments.documentId],
			name: 'campaign_import_chronology_provenance_document_fk'
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.campaignId, table.vaultRevisionId],
			foreignColumns: [vaultRevisions.campaignId, vaultRevisions.revisionId],
			name: 'campaign_import_chronology_provenance_revision_fk'
		}).onDelete('cascade'),
		index('campaign_import_chronology_provenance_ingestion_index').on(
			table.campaignId,
			table.ingestionId
		),
		index('campaign_import_chronology_provenance_source_index').on(
			table.campaignId,
			table.sourceId,
			table.sourceRevisionId
		),
		index('campaign_import_chronology_provenance_document_index').on(
			table.campaignId,
			table.affectedDocumentId
		)
	]
)
