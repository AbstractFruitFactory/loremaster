import { z } from 'zod'

const conversationHistory = z
	.array(
		z
			.object({
				role: z.enum(['user', 'assistant']),
				content: z.string().trim().min(1).max(2_000)
			})
			.strict()
	)
	.max(12)

export const askLoremasterRequestSchema = z
	.object({
		message: z.string().trim().min(1).max(2_000)
	})
	.strict()

export const askLoremasterCommandSchema = askLoremasterRequestSchema.extend({
	campaignId: z.uuid(),
	history: conversationHistory
})
