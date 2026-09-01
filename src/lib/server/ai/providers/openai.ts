import { fail, tryPromise } from 'effect/Effect'
import OpenAI from 'openai'
import type {
	Response as OpenAiResponse,
	ResponseStreamEvent
} from 'openai/resources/responses/responses'
import { z } from 'zod'
import { documentTypes, isDocumentType } from '../../../document'
import type { AssistantGeneration, AssistantGenerationEvent } from '../../assistant/types'
import { failure } from '../../failure'
import { EMBEDDING_DIMENSIONS, type AiModels, type AiProvider } from '../provider'

type OpenAiClient = Pick<OpenAI, 'embeddings' | 'responses'>

export const openAiModels = {
	assistant: 'gpt-5.6-terra',
	campaignSummary: 'gpt-5.6-luna',
	documentSummary: 'gpt-5.6-luna',
	documentType: 'gpt-5.6-luna',
	embeddings: 'text-embedding-3-small',
} satisfies AiModels

const loreProposalSchema = z.object({
	title: z.string().trim().min(1),
	category: z.enum(documentTypes),
	content: z.string().trim().min(1)
})

const loreProposalTool = {
	type: 'function' as const,
	name: 'propose_lore',
	description:
		'Propose a new or changed canonical campaign entry when the Dungeon Master is establishing or changing campaign canon.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			title: { type: 'string' },
			category: { type: 'string', enum: documentTypes },
			content: { type: 'string' }
		},
		required: ['title', 'category', 'content'],
		additionalProperties: false
	}
}

const requestInput = ({ system, prompt }: { system?: string; prompt: string }) => ({
	...(system ? { instructions: system } : {}),
	input: prompt
})

export const parseAssistantResponse = (response: OpenAiResponse): AssistantGeneration => {
	const functionCall = response.output.find(
		(item) => item.type === 'function_call' && item.name === loreProposalTool.name
	)
	const proposal =
		functionCall?.type === 'function_call'
			? loreProposalSchema.parse(JSON.parse(functionCall.arguments))
			: undefined

	return {
		message:
			response.output_text.trim() ||
			(proposal
				? 'I drafted a lore suggestion for your review.'
				: 'I could not generate a response.'),
		...(proposal ? { proposal } : {})
	}
}

export const assistantEvents = async function* (
	stream: AsyncIterable<ResponseStreamEvent>
): AsyncIterable<AssistantGenerationEvent> {
	let hasText = false
	let proposal: AssistantGeneration['proposal']

	for await (const event of stream) {
		if (event.type === 'response.output_text.delta') {
			hasText ||= Boolean(event.delta)
			yield { type: 'text-delta', delta: event.delta }
			continue
		}

		if (
			event.type === 'response.function_call_arguments.done' &&
			event.name === loreProposalTool.name
		) {
			proposal = loreProposalSchema.parse(JSON.parse(event.arguments))
			continue
		}

		if (event.type === 'error') {
			throw new Error(event.message)
		}

		if (event.type === 'response.failed') {
			throw new Error(event.response.error?.message ?? 'OpenAI response failed')
		}
	}

	if (proposal) {
		if (!hasText) {
			yield { type: 'text-delta', delta: 'I drafted a lore suggestion for your review.' }
		}

		yield { type: 'proposal', proposal }
	}
}

export const openAiProvider = (client: OpenAiClient): AiProvider => ({
	models: openAiModels,
	generateText: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt })
				})

				return response.output_text.trim()
			},
			catch: (cause) => failure('ai', 'generateText', cause)
		}),

	generateAssistant: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [loreProposalTool]
				})

				return parseAssistantResponse(response)
			},
			catch: (cause) => failure('ai', 'generateAssistant', cause)
		}),

	streamAssistant: ({ model, system, prompt, signal }) =>
		tryPromise({
			try: async () => {
				const stream = await client.responses.create(
					{
						model,
						...requestInput({ system, prompt }),
						tools: [loreProposalTool],
						stream: true
					},
					{ signal }
				)

				return assistantEvents(stream)
			},
			catch: (cause) => failure('ai', 'streamAssistant', cause)
		}),

	embedTexts: ({ model, values }) =>
		tryPromise({
			try: async () => {
				const response = await client.embeddings.create({
					model,
					input: values,
					dimensions: EMBEDDING_DIMENSIONS,
					encoding_format: 'float'
				})

				return response.data
					.toSorted((left, right) => left.index - right.index)
					.map(({ embedding }) => embedding)
			},
			catch: (cause) => failure('ai', 'embedTexts', cause)
		}),

	inferDocumentType: ({ model, path, title, content }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					instructions: `Classify campaign documents. Respond with exactly one of: ${documentTypes.join(', ')}.`,
					input: `Path: ${path}\nTitle: ${title}\n\n${content}`
				})
				const documentType = response.output_text.trim().toLocaleLowerCase()

				if (!isDocumentType(documentType)) {
					throw new Error(`OpenAI returned invalid document type "${documentType}"`)
				}

				return documentType
			},
			catch: (cause) => failure('ai', 'inferDocumentType', cause)
		})
})

export const createOpenAiProvider = (apiKey?: string): AiProvider => {
	if (apiKey) {
		return openAiProvider(new OpenAI({ apiKey }))
	}

	const missingApiKey = <Operation extends string>(operation: Operation) =>
		fail(failure('ai', operation, { reason: 'missingOpenAiApiKey' }))

	return {
		models: openAiModels,
		generateText: () => missingApiKey('generateText'),
		generateAssistant: () => missingApiKey('generateAssistant'),
		streamAssistant: () => missingApiKey('streamAssistant'),
		embedTexts: () => missingApiKey('embedTexts'),
		inferDocumentType: () => missingApiKey('inferDocumentType')
	}
}
