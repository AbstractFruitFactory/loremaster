import {
	MAX_CAMPAIGN_IMPORT_BYTES,
	MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS,
	MAX_CAMPAIGN_IMPORT_SOURCE_BYTES,
	MAX_CAMPAIGN_IMPORT_SOURCES
} from '@loremaster/core/server/ingestion/types'
import { z } from 'zod'

const campaignId = z.uuid()
const ingestionId = z.uuid()
const title = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.refine((value) => !/[\r\n]/u.test(value))
const displayName = z
	.string()
	.trim()
	.min(1)
	.max(500)
	.refine((value) => {
		const normalized = value.toLocaleLowerCase()
		return normalized.endsWith('.md') || normalized.endsWith('.txt')
	})
const importSource = z
	.object({
		displayName,
		title,
		mediaType: z.enum(['text/markdown', 'text/plain']),
		content: z.string().min(1)
	})
	.strict()
	.superRefine((source, context) => {
		if (Buffer.byteLength(source.content) > MAX_CAMPAIGN_IMPORT_SOURCE_BYTES) {
			context.addIssue({
				code: 'custom',
				message: 'Each import source must be at most 2 MB',
				path: ['content']
			})
		}
	})

export const startCampaignImportInput = z
	.object({
		campaignId,
		ingestionId: ingestionId.optional(),
		sources: z.array(importSource).min(1).max(MAX_CAMPAIGN_IMPORT_SOURCES)
	})
	.strict()
	.superRefine(({ sources }, context) => {
		if (
			sources.reduce((total, source) => total + Buffer.byteLength(source.content), 0) >
			MAX_CAMPAIGN_IMPORT_BYTES
		) {
			context.addIssue({
				code: 'custom',
				message: 'Campaign import content must be at most 10 MB',
				path: ['sources']
			})
		}
	})

export const campaignImportReferenceInput = z.object({ campaignId, ingestionId }).strict()

const proposalId = z.uuid()
export const campaignImportProposalResolutionInput = z.discriminatedUnion('kind', [
	z.object({ proposalId, kind: z.literal('create') }).strict(),
	z
		.object({
			proposalId,
			kind: z.literal('existing'),
			documentId: z.string().trim().min(1).max(200)
		})
		.strict()
])

export const commitCampaignImportInput = campaignImportReferenceInput
	.extend({
		expectedReviewRevision: z.number().int().min(0),
		selectedProposalIds: z
			.array(proposalId)
			.max(MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS, 'At most 500 proposals can be committed at once'),
		resolutions: z
			.array(campaignImportProposalResolutionInput)
			.max(
				MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS,
				'At most 500 identity resolutions can be committed at once'
			)
			.optional()
	})
	.strict()

export const saveCampaignImportReviewStateInput = campaignImportReferenceInput
	.extend({
		expectedRevision: z.number().int().min(0),
		selectedProposalIds: z.array(proposalId),
		resolutions: z.array(campaignImportProposalResolutionInput)
	})
	.strict()

export const commitCampaignImportChronologyInput = campaignImportReferenceInput
	.extend({
		selectedChronologyIds: z.array(z.uuid()).max(MAX_CAMPAIGN_IMPORT_COMMIT_SELECTIONS)
	})
	.strict()
