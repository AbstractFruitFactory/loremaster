import type { AiModels, AiProvider } from './provider.js'
import { createOpenAiProvider, openAiModels } from './providers/openai.js'
import { createJevProvider } from './providers/jev.js'

/** Route each operation by its selected model; credentials stay inside the providers. */
export const createAiProvider = (models: Partial<AiModels> = {}): AiProvider => {
	const openai = createOpenAiProvider()
	const jev = createJevProvider()
	return {
		...openai,
		models: {
			...openAiModels,
			entityResolution: 'jev-latest',
			...models
		},
		resolveSessionEntities: (input) =>
			input.model.startsWith('jev-')
				? jev.resolveSessionEntities(input)
				: openai.resolveSessionEntities(input)
	}
}
