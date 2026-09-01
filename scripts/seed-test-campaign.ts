/// <reference types="node" />

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { runPromise } from 'effect/Effect'
import { vault } from '#lib/server/app.js'
import { closeDb, db } from '#lib/server/db/index.js'
import { campaigns, vaultDocuments } from '#lib/server/db/schema.js'
import { seedCampaign, seedDocuments, seedDocumentSummary } from './seed/content.js'

const reset = process.argv.includes('--reset')

const resetSeedCampaign = async () => {
	await db.delete(campaigns).where(eq(campaigns.id, seedCampaign.id))
	rmSync(resolve('data/campaigns', seedCampaign.id), { recursive: true, force: true })
}

const seedCampaignDocuments = async (campaignId: string) => {
	const eventIds = new Map<string, string>()
	const summaries: { documentId: string; summary: string }[] = []

	for (const document of seedDocuments) {
		const after = document.afterEventKey
			? [eventIds.get(document.afterEventKey)].filter((id): id is string => Boolean(id))
			: undefined

		const created = await runPromise(
			vault.createDocument(campaignId, {
				path: document.path,
				type: document.type,
				aliases: document.aliases,
				after,
				content: document.content
			})
		)

		if (document.eventKey) {
			eventIds.set(document.eventKey, created.id)
		}

		summaries.push({
			documentId: created.id,
			summary: seedDocumentSummary(document)
		})

		console.log(`  • ${document.type.padEnd(8)} ${created.title}`)
	}

	console.log('Resolving document links…')
	await runPromise(vault.reindexCampaign(campaignId))

	console.log('Applying seed summaries…')
	await Promise.all(
		summaries.map(({ documentId, summary }) =>
			db
				.update(vaultDocuments)
				.set({ summary })
				.where(
					and(eq(vaultDocuments.campaignId, campaignId), eq(vaultDocuments.documentId, documentId))
				)
		)
	)
}

const main = async () => {
	if (!process.env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not set. Run with: pnpm db:seed')
	}

	if (reset) {
		console.log('Resetting seed campaign…')
		await resetSeedCampaign()
	}

	const [existingCampaign] = await db
		.select({ id: campaigns.id })
		.from(campaigns)
		.where(eq(campaigns.id, seedCampaign.id))
		.limit(1)

	if (existingCampaign && !reset) {
		console.log('Seed campaign already exists.')
		console.log(`Campaign ID: ${seedCampaign.id}`)
		console.log(`Open: http://localhost:5173/campaigns/${seedCampaign.id}`)
		console.log('Use pnpm db:seed -- --reset to recreate it.')
		return
	}

	await db.insert(campaigns).values(seedCampaign)

	console.log(`Seeding "${seedCampaign.name}"…`)
	await seedCampaignDocuments(seedCampaign.id)

	console.log('')
	console.log('Seed complete.')
	console.log(`Campaign ID: ${seedCampaign.id}`)
	console.log(`Open: http://localhost:5173/campaigns/${seedCampaign.id}`)
}

main()
	.catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
	.finally(() => closeDb())
