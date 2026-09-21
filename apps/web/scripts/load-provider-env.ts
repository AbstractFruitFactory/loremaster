import { loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'

/** Vite keeps .env values separate from process.env; Node-based providers need these server values. */
export const loadProviderEnv = (mode: string) => {
	const env = loadEnv(mode, fileURLToPath(new URL('../../../', import.meta.url)), '')
	for (const key of ['OPENAI_API_KEY', 'TYPESAFE_API_KEY']) {
		if (process.env[key] === undefined && env[key] !== undefined) process.env[key] = env[key]
	}
}
