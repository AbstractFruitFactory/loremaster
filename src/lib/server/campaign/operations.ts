import { flatMap, map, succeed } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { GenerateText } from '../ai/generate'
import type * as CampaignDb from '../db/campaign'
import { fail } from '../failure'
import { campaignSummaryPrompt } from './summary'

type CampaignDependencies = {
	ai: {
		generateText: GenerateText
	}
	db: typeof CampaignDb
}

export const campaignOperations = ({ ai, db }: CampaignDependencies) => {
	const getCampaign = (id: string) =>
		pipe(
			db.getById(id),
			flatMap((campaign) =>
				campaign ? succeed(campaign) : fail('campaign', 'getCampaign', { campaignId: id })
			)
		)

	const generateCampaignSummary = (id: string) =>
		pipe(
			getCampaign(id),
			flatMap((campaign) =>
				pipe(
					ai.generateText(campaignSummaryPrompt(campaign)),
					map((content) => ({ campaignId: campaign.id, content }))
				)
			)
		)

	return {
		createCampaign: db.create,
		generateCampaignSummary,
		getCampaign,
		listCampaigns: db.list
	}
}
