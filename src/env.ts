import { defineEnvVars } from '@sveltejs/kit/env'

const optionalString = { schema: (input: string | undefined) => input ?? '' }

export const variables = defineEnvVars({
	DATABASE_URL: optionalString,
	MOCK_AI_PROVIDER: optionalString,
	OPENAI_API_KEY: optionalString
})
