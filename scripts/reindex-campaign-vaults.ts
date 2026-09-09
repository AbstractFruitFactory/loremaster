/// <reference types="node" />

import { runPromise } from 'effect/Effect'
import { vault } from '#lib/server/app.js'
import * as campaignDb from '#lib/server/db/campaign.js'
import { closeDb } from '#lib/server/db/index.js'

const main = async () => {
	if (!process.env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not set. Run with: pnpm db:reindex-vaults')
	}

	const campaigns = await runPromise(campaignDb.list())
	for (const campaign of campaigns) {
		console.log(`Reindexing "${campaign.name}" (${campaign.id})…`)
		const documents = await runPromise(vault.reindexCampaign(campaign.id))
		console.log(`  • ${documents.length} documents indexed`)
	}

	if (!campaigns.length) console.log('No campaigns found.')
}

main()
	.catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
	.finally(() => closeDb())
