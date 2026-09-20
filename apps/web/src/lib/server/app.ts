import {
	DATABASE_URL,
	LOREMASTER_DATA_ROOT,
	MOCK_AI_PROVIDER,
	OPENAI_API_KEY,
	SUPABASE_SERVICE_ROLE_KEY,
	SUPABASE_STORAGE_BUCKET,
	SUPABASE_URL,
	VERCEL
} from '$app/env/private'
import { building } from '$app/env'
import { createCoreRuntime } from '@loremaster/core'
import { resolve } from 'node:path'

const configuredVaultRoot = LOREMASTER_DATA_ROOT || undefined
const isLive = VERCEL === '1'
const hasSupabaseStorage = !!SUPABASE_URL && !!SUPABASE_SERVICE_ROLE_KEY
if (isLive && !building && !hasSupabaseStorage) {
	throw new Error('Vercel deployments require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}
const vaultRoot = resolve(
	configuredVaultRoot ?? (isLive ? '/tmp/loremaster/campaigns' : '../../data/campaigns')
)
const services = createCoreRuntime({
	databaseUrl: DATABASE_URL,
	vaultRoot,
	...(isLive && hasSupabaseStorage
		? {
				supabaseStorage: {
					url: SUPABASE_URL,
					serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
					...(SUPABASE_STORAGE_BUCKET ? { bucket: SUPABASE_STORAGE_BUCKET } : {})
				}
			}
		: {}),
	openAiApiKey: OPENAI_API_KEY,
	useMockAi: MOCK_AI_PROVIDER === 'true'
})

export const {
	assistant,
	campaign,
	campaignImport,
	context,
	ingestion,
	lore,
	revisions,
	timeline,
	vault
} = services
export const disposeCoreRuntime = services.dispose
