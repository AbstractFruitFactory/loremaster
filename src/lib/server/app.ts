import { MOCK_AI_PROVIDER, OPENAI_API_KEY } from '$app/env/private'
import { mockAiProvider } from './ai/providers/mock'
import { createOpenAiProvider } from './ai/providers/openai'
import { createServices } from './services'

const useMockAi = MOCK_AI_PROVIDER === 'true'
const provider = useMockAi ? mockAiProvider : createOpenAiProvider(OPENAI_API_KEY)
const services = createServices(provider)

export const { assistant, campaign, context, lore, timeline, vault } = services
