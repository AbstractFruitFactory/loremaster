import {
	DATABASE_URL,
	LOREMASTER_DATA_ROOT,
	MOCK_AI_PROVIDER,
	OPENAI_API_KEY
} from '$app/env/private'
import { building } from '$app/env'
import { createCoreRuntime } from '@loremaster/core'
import { isAbsolute, resolve } from 'node:path'

const configuredVaultRoot = LOREMASTER_DATA_ROOT || undefined
if (
	process.env.NODE_ENV === 'production' &&
	!building &&
	(!configuredVaultRoot || !isAbsolute(configuredVaultRoot))
) {
	throw new Error('Production LOREMASTER_DATA_ROOT must be an absolute path')
}
const vaultRoot = resolve(configuredVaultRoot ?? '../../data/campaigns')
const services = createCoreRuntime({
	databaseUrl: DATABASE_URL,
	vaultRoot,
	openAiApiKey: OPENAI_API_KEY,
	useMockAi: MOCK_AI_PROVIDER === 'true'
})

export const { assistant, campaign, context, ingestion, lore, revisions, timeline, vault } =
	services
export const disposeCoreRuntime = services.dispose
