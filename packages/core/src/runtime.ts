import { mockAiProvider } from './server/ai/providers/mock'
import { createOpenAiProvider } from './server/ai/providers/openai'
import { closeDb } from './server/db/index'
import { closeVectorStore } from './server/db/vector'
import { createServices } from './server/services'
import type { CoreRuntimeConfig } from './runtime-config'

const disposeCoreResources = async () => {
	const results = await Promise.allSettled([closeVectorStore(), closeDb()])
	const failures = results.flatMap((result) =>
		result.status === 'rejected' ? [result.reason] : []
	)
	if (failures.length) throw new AggregateError(failures, 'Failed to dispose core resources')
}

export const createCoreRuntime = (config: CoreRuntimeConfig) => {
	const aiProvider = config.useMockAi ? mockAiProvider : createOpenAiProvider(config.openAiApiKey)
	const services = createServices(aiProvider, {
		databaseUrl: config.databaseUrl,
		...(config.vaultRoot ? { vaultRoot: config.vaultRoot } : {}),
		...(config.supabaseStorage ? { supabaseStorage: config.supabaseStorage } : {})
	})
	return { ...services, dispose: disposeCoreResources }
}

export type { CoreRuntimeConfig } from './runtime-config'
