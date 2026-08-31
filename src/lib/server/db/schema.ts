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
