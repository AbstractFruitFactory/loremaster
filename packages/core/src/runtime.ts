import { mockAiProvider } from './server/ai/providers/mock.js'
import { createOpenAiProvider } from './server/ai/providers/openai.js'
import { closeDb } from './server/db/index.js'
import { closeVectorStore } from './server/db/vector.js'
import { createServices } from './server/services.js'
import type { CoreRuntimeConfig } from './runtime-config.js'

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
		...(config.databaseMaxConnections
			? { databaseMaxConnections: config.databaseMaxConnections }
			: {}),
		...(config.vaultRoot ? { vaultRoot: config.vaultRoot } : {}),
		...(config.supabaseStorage ? { supabaseStorage: config.supabaseStorage } : {})
	})
	return { ...services, dispose: disposeCoreResources }
}

export type { CoreRuntimeConfig } from './runtime-config.js'
