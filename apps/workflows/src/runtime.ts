import { createCoreRuntime } from '@loremaster/core'
import { resolve } from 'node:path'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) throw new Error('DATABASE_URL is not set')

const configuredVaultRoot = process.env.LOREMASTER_DATA_ROOT
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const isLive = process.env.NODE_ENV === 'production'
const hasSupabaseStorage = !!supabaseUrl && !!supabaseServiceRoleKey
if (isLive && !hasSupabaseStorage) {
	throw new Error('Production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}
const vaultRoot = resolve(
	configuredVaultRoot ?? (isLive ? '/tmp/loremaster/campaigns' : '../../data/campaigns')
)

export const runtime = createCoreRuntime({
	databaseUrl,
	vaultRoot,
	...(isLive && hasSupabaseStorage
		? {
				supabaseStorage: {
					url: supabaseUrl,
					serviceRoleKey: supabaseServiceRoleKey,
					...(process.env.SUPABASE_STORAGE_BUCKET
						? { bucket: process.env.SUPABASE_STORAGE_BUCKET }
						: {})
				}
			}
		: {}),
	useMockAi: process.env.MOCK_AI_PROVIDER === 'true'
})
