import { z } from 'zod'

export const askLoremasterRequestSchema = z
	.object({
		message: z.string().trim().min(1).max(2_000),
		history: z
			.array(
				z
					.object({
						role: z.enum(['user', 'assistant']),
						content: z.string().trim().min(1).max(2_000)
					})
					.strict()
			)
			.max(12)
	})
	.strict()

export const askLoremasterCommandSchema = askLoremasterRequestSchema.extend({
	campaignId: z.uuid()
})
