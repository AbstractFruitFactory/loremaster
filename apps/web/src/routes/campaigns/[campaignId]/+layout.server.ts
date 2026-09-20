import { requireCampaignOwner } from '#lib/server/auth/authorization.js'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ params }) => {
	await requireCampaignOwner(params.campaignId)
	return {}
}
