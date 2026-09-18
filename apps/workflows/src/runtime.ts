import { createCoreRuntime } from '@loremaster/core'
import { isAbsolute, resolve } from 'node:path'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) throw new Error('DATABASE_URL is not set')

const configuredVaultRoot = process.env.LOREMASTER_DATA_ROOT
if (
	process.env.NODE_ENV === 'production' &&
	(!configuredVaultRoot || !isAbsolute(configuredVaultRoot))
) {
	throw new Error('Production LOREMASTER_DATA_ROOT must be an absolute path')
}
const vaultRoot = resolve(configuredVaultRoot ?? '../../data/campaigns')

export const runtime = createCoreRuntime({
	databaseUrl,
	vaultRoot,
	...(process.env.OPENAI_API_KEY ? { openAiApiKey: process.env.OPENAI_API_KEY } : {}),
	useMockAi: process.env.MOCK_AI_PROVIDER === 'true'
})
