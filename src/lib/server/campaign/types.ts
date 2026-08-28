export type Campaign = {
	id: string
	name: string
	description: string
	createdAt: string
}

export type CampaignSummary = {
	campaignId: string
	content: string
}

export type Character = {
	id: string
	campaignId: string
	name: string
	documentId: string
}
