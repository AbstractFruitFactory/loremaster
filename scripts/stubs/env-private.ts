/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const loadEnvFile = () => {
	const envPath = resolve(process.cwd(), '.env')
	if (!existsSync(envPath)) return

	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue

		const index = trimmed.indexOf('=')
		if (index === -1) continue

		const key = trimmed.slice(0, index).trim()
		const value = trimmed
			.slice(index + 1)
			.trim()
			.replace(/^"|"$/g, '')

		if (!(key in process.env)) {
			process.env[key] = value
		}
	}
}

loadEnvFile()

const url = process.env.DATABASE_URL

if (!url) {
	throw new Error(
		'DATABASE_URL is not set. Copy .env.example to .env and run with node --env-file=.env'
	)
}

export const DATABASE_URL = url
export const MOCK_AI_PROVIDER = process.env.MOCK_AI_PROVIDER ?? ''
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
