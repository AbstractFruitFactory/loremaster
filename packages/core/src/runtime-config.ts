import type { SupabaseStorageConfig } from './server/storage/supabase.js'

export type CoreRuntimeConfig = {
	databaseUrl: string
	vaultRoot?: string
	supabaseStorage?: SupabaseStorageConfig
	openAiApiKey?: string
	useMockAi?: boolean
}
