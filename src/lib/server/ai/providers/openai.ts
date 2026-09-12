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
import {
	ingestionDocumentTypes,
	type ExtractedSessionClaim,
	type SessionEntityResolution
} from '../../ingestion/types'
import { EMBEDDING_DIMENSIONS, type AiModels, type AiProvider } from '../provider'

type OpenAiClient = Pick<OpenAI, 'embeddings' | 'responses'>

export const openAiModels = {
	assistant: 'gpt-5.6-terra',
	campaignSummary: 'gpt-5.6-luna',
	documentSummary: 'gpt-5.6-luna',
	documentType: 'gpt-5.6-luna',
	sessionAnalysis: 'gpt-5.6-terra',
	embeddings: 'text-embedding-3-small'
} satisfies AiModels

const entityMentionSchema = z.object({
	mention: z.string().trim().min(1),
	type: z.enum(ingestionDocumentTypes)
})

const sessionClaimsSchema = z.object({
	claims: z.array(
		z.object({
			excerpt: z.string().min(1),
			kind: z.enum(['stable-fact', 'development', 'mention']),
			certainty: z.enum(['explicit', 'inferred']),
			content: z.string().trim().min(1),
			entityMentions: z.array(entityMentionSchema)
		})
	)
})

const sessionClaimsTool = {
	type: 'function' as const,
	name: 'record_session_claims',
	description:
		'Record atomic campaign claims as evidence plus the entity mentions present in that evidence. Claims do not choose Lore documents or document titles.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			claims: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						excerpt: { type: 'string' },
						kind: { type: 'string', enum: ['stable-fact', 'development', 'mention'] },
						certainty: { type: 'string', enum: ['explicit', 'inferred'] },
						content: { type: 'string' },
						entityMentions: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									mention: { type: 'string' },
									type: { type: 'string', enum: ingestionDocumentTypes }
								},
								required: ['mention', 'type'],
								additionalProperties: false
							}
						}
					},
					required: ['excerpt', 'kind', 'certainty', 'content', 'entityMentions'],
					additionalProperties: false
				}
			}
		},
		required: ['claims'],
		additionalProperties: false
	}
}

const parseSessionClaims = (response: OpenAiResponse): ExtractedSessionClaim[] => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === sessionClaimsTool.name
	)
	return call?.type === 'function_call'
		? sessionClaimsSchema.parse(JSON.parse(call.arguments)).claims
		: []
}

const sessionEntityResolutionsSchema = z.object({
	resolutions: z.array(
		z.object({
			referenceId: z.string().trim().min(1),
			targetId: z.string().trim().min(1).nullable()
		})
	)
})

const sessionEntityResolutionsTool = {
	type: 'function' as const,
	name: 'resolve_session_entities',
	description:
		'Resolve ambiguous entity mentions by choosing only from the supplied candidate targets, or leave them unresolved.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			resolutions: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						referenceId: { type: 'string' },
						targetId: { type: ['string', 'null'] }
					},
					required: ['referenceId', 'targetId'],
					additionalProperties: false
				}
			}
		},
		required: ['resolutions'],
		additionalProperties: false
	}
}

const parseSessionEntityResolutions = (response: OpenAiResponse): SessionEntityResolution[] => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === sessionEntityResolutionsTool.name
	)
	return call?.type === 'function_call'
		? sessionEntityResolutionsSchema.parse(JSON.parse(call.arguments)).resolutions
		: []
}

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
		}),

	analyzeSessionChunk: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [sessionClaimsTool],
					tool_choice: { type: 'function', name: sessionClaimsTool.name }
				})
				return parseSessionClaims(response)
			},
			catch: (cause) => failure('ai', 'analyzeSessionChunk', cause)
		}),

	resolveSessionEntities: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [sessionEntityResolutionsTool],
					tool_choice: { type: 'function', name: sessionEntityResolutionsTool.name }
				})
				return parseSessionEntityResolutions(response)
			},
			catch: (cause) => failure('ai', 'resolveSessionEntities', cause)
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
		inferDocumentType: () => missingApiKey('inferDocumentType'),
		analyzeSessionChunk: () => missingApiKey('analyzeSessionChunk'),
		resolveSessionEntities: () => missingApiKey('resolveSessionEntities')
	}
}
