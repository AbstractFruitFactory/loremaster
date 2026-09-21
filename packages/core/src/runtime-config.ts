import type { SupabaseStorageConfig } from './server/storage/supabase.js'

export type CoreRuntimeConfig = {
	databaseUrl: string
	databaseMaxConnections?: number
	vaultRoot?: string
	supabaseStorage?: SupabaseStorageConfig
	useMockAi?: boolean
}
