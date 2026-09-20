import { defineEnvVars } from '@sveltejs/kit/env'

const optionalString = { schema: (input: string | undefined) => input ?? '' }

export const variables = defineEnvVars({
	DATABASE_URL: optionalString,
	AUTH_ALLOWED_EMAILS: optionalString,
	AUTH_SIGNUP_CODE: optionalString,
	LOREMASTER_DATA_ROOT: optionalString,
	MOCK_AI_PROVIDER: optionalString,
	OPENAI_API_KEY: optionalString
})
