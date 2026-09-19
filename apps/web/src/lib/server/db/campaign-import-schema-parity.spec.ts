import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as coreSchema from '../../../../../../packages/core/src/server/db/schema.js'
import * as webSchema from './schema.js'

const indexColumnName = (column: unknown) => {
	const name = (column as { name?: unknown }).name
	if (typeof name !== 'string') throw new Error('Campaign import indexes must use named columns')
	return name
}

const campaignImportStructure = (schema: Record<string, unknown>) =>
	Object.values(schema)
		.filter((value): value is PgTable => is(value, PgTable))
		.map((table) => getTableConfig(table))
		.filter(({ name }) => name.startsWith('campaign_import_'))
		.map((config) => ({
			name: config.name,
			columns: config.columns.map((column) => ({
				name: column.name,
				columnType: column.columnType,
				dataType: column.dataType,
				notNull: column.notNull,
				hasDefault: column.hasDefault,
				enumValues: column.enumValues
			})),
			indexes: [
				...config.indexes.map(({ config: index }) => ({
					kind: index.unique ? 'unique-index' : 'index',
					name: index.name,
					columns: index.columns.map(indexColumnName),
					method: index.method ?? 'btree'
				})),
				...config.primaryKeys.map((primaryKey) => ({
					kind: 'primary-key',
					name: primaryKey.getName(),
					columns: primaryKey.columns.map(({ name }) => name),
					method: 'btree'
				})),
				...config.uniqueConstraints.map((constraint) => ({
					kind: 'unique-constraint',
					name: constraint.getName(),
					columns: constraint.columns.map(({ name }) => name),
					method: 'btree'
				}))
			].sort((left, right) => left.name!.localeCompare(right.name!))
		}))
		.sort((left, right) => left.name.localeCompare(right.name))

describe('campaign import database schema parity', () => {
	it('keeps core and web table structures equal', () => {
		const core = campaignImportStructure(coreSchema)
		const web = campaignImportStructure(webSchema)

		expect(core.map(({ name }) => name)).toEqual([
			'campaign_import_accepted_claims',
			'campaign_import_chronology_provenance',
			'campaign_import_claim_provenance',
			'campaign_import_source_revisions'
		])
		expect(web).toEqual(core)
	})
})
