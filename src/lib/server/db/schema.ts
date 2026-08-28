import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const campaigns = pgTable('campaigns', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	description: text('description').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
})
