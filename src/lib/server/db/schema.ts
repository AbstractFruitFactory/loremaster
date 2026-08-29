import { foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { documentTypes } from '../../document'

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
		type: text('type', { enum: documentTypes }),
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

export const characters = pgTable(
	'characters',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		campaignId: uuid('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		documentId: text('document_id').notNull()
	},
	(table) => [
		uniqueIndex('characters_campaign_document_id_unique').on(table.campaignId, table.documentId),
		index('characters_campaign_id_index').on(table.campaignId)
	]
)
