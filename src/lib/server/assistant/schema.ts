import { z } from 'zod'

export const askLoremasterRequestSchema = z
	.object({
		message: z.string().trim().min(1).max(2_000)
	})
	.strict()
