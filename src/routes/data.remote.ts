import { command, query } from '$app/server'
import { error } from '@sveltejs/kit'
import { match, runPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { z } from 'zod'
import { campaign } from '#lib/server/app.js'

const campaignInput = z
	.object({
		name: z.string().trim().min(1),
		description: z.string().trim().min(1)
	})
	.strict()

const campaignId = z.uuid()

export const listCampaigns = query(() =>
	runPromise(
		pipe(
			campaign.listCampaigns(),
			match({
				onFailure: () => error(500, 'Unable to list campaigns'),
				onSuccess: (campaigns) => campaigns
			})
		)
	)
)

export const getCampaign = query(campaignId, (id) =>
	runPromise(
		pipe(
			campaign.getCampaign(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					error(500, 'Unable to load campaign')
				},
				onSuccess: (campaign) => campaign
			})
		)
	)
)

export const createCampaign = command(campaignInput, (input) =>
	runPromise(
		pipe(
			campaign.createCampaign(input),
			match({
				onFailure: () => error(500, 'Unable to create campaign'),
				onSuccess: (campaign) => campaign
			})
		)
	)
)

export const generateCampaignSummary = command(campaignId, (id) =>
	runPromise(
		pipe(
			campaign.generateCampaignSummary(id),
			match({
				onFailure: (failure) => {
					if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
						error(404, `Campaign "${id}" was not found`)
					}

					error(500, 'Unable to generate summary')
				},
				onSuccess: (summary) => summary
			})
		)
	)
)
