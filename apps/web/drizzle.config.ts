import { defineConfig } from 'drizzle-kit'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const envPath = fileURLToPath(new URL('../../.env', import.meta.url))

if (!process.env.DATABASE_URL && existsSync(envPath)) loadEnvFile(envPath)

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL },
	verbose: true,
	strict: true
})
