import { fail, tryPromise } from 'effect/Effect'
import OpenAI from 'openai'
import type {
	Response as OpenAiResponse,
	ResponseStreamEvent
} from 'openai/resources/responses/responses'
import { z } from 'zod'
import { documentTypes, isDocumentType, loreDocumentTypes } from '../../../document.js'
import type { AssistantGeneration, AssistantGenerationEvent } from '../../assistant/types.js'
import { failure } from '../../failure.js'
import {
	ingestionDocumentTypes,
	sessionClaimValidationReasons,
	type ExtractedSessionClaim,
	type InferredCampaignImportChronology,
	type InferredSessionChronology,
	type SessionEventAudit,
	type SessionClaimEvidenceRepair,
	type SessionClaimValidation,
	type SessionEntityResolution
} from '../../ingestion/types.js'
import { MAX_EVIDENCE_RANGES } from '../../ingestion/evidence.js'
import { eventForms, type RelationshipLink } from '../../vault/types.js'
import { EMBEDDING_DIMENSIONS, type AiModels, type AiProvider } from '../provider.js'

type OpenAiClient = Pick<OpenAI, 'embeddings' | 'responses'>

export const openAiModels = {
	assistant: 'gpt-5.6-terra',
	campaignSummary: 'gpt-5.6-luna',
	documentSummary: 'gpt-5.6-luna',
	documentType: 'gpt-5.6-luna',
	sessionAnalysis: 'gpt-5.6-terra',
	relationshipLinks: 'gpt-5.6-luna',
	embeddings: 'text-embedding-3-small'
} satisfies AiModels

const evidenceRangeSchema = z.object({
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive()
})

const entityReferenceSchema = z.object({
	label: z.string().trim().min(1),
	type: z.enum(ingestionDocumentTypes),
	role: z.enum(['subject', 'related']),
	eventForm: z.enum(eventForms).nullable().optional()
})

const sessionClaimSchema = z.object({
	kind: z.enum(['stable-fact', 'development', 'mention']),
	eventTitle: z.string().trim().min(1).max(60).nullable(),
	certainty: z.enum(['explicit', 'inferred']),
	content: z.string().trim().min(1),
	evidence: z.array(evidenceRangeSchema).min(1).max(MAX_EVIDENCE_RANGES),
	entityReferences: z.array(entityReferenceSchema)
})

const sessionClaimsSchema = z.object({ claims: z.array(sessionClaimSchema) })

const evidenceRangeJsonSchema = {
	type: 'object' as const,
	properties: {
		startLine: { type: 'integer' },
		endLine: { type: 'integer' }
	},
	required: ['startLine', 'endLine'],
	additionalProperties: false
}

const entityReferenceJsonSchema = {
	type: 'object' as const,
	properties: {
		label: { type: 'string' },
		type: { type: 'string', enum: ingestionDocumentTypes },
		role: { type: 'string', enum: ['subject', 'related'] },
		eventForm: { type: ['string', 'null'], enum: [...eventForms, null] }
	},
	required: ['label', 'type', 'role', 'eventForm'],
	additionalProperties: false
}

const sessionClaimJsonSchema = {
	type: 'object' as const,
	properties: {
		kind: { type: 'string', enum: ['stable-fact', 'development', 'mention'] },
		eventTitle: { type: ['string', 'null'], minLength: 1, maxLength: 60 },
		certainty: { type: 'string', enum: ['explicit', 'inferred'] },
		content: { type: 'string' },
		evidence: {
			type: 'array',
			items: evidenceRangeJsonSchema,
			minItems: 1,
			maxItems: MAX_EVIDENCE_RANGES
		},
		entityReferences: { type: 'array', items: entityReferenceJsonSchema }
	},
	required: ['kind', 'eventTitle', 'certainty', 'content', 'evidence', 'entityReferences'],
	additionalProperties: false
}

const sessionClaimsTool = {
	type: 'function' as const,
	name: 'record_session_claims',
	description:
		'Record atomic campaign claims with supporting transcript line ranges, subject and related entity references, event form for event references, and concise factual titles for developments.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			claims: {
				type: 'array',
				items: sessionClaimJsonSchema
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

const sessionClaimValidationsSchema = z.object({
	validations: z.array(
		z.object({
			candidateId: z.string().trim().min(1),
			accepted: z.boolean(),
			certainty: z.enum(['explicit', 'inferred']),
			reason: z.enum(sessionClaimValidationReasons),
			referenceValidations: z.array(
				z.object({
					referenceId: z.string().trim().min(1),
					accepted: z.boolean()
				})
			)
		})
	)
})

const sessionClaimValidationsTool = {
	type: 'function' as const,
	name: 'validate_session_claims',
	description:
		'Validate claim content and semantic entity-reference subject or related roles independently without rewriting them.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			validations: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						candidateId: { type: 'string' },
						accepted: { type: 'boolean' },
						certainty: { type: 'string', enum: ['explicit', 'inferred'] },
						reason: { type: 'string', enum: sessionClaimValidationReasons },
						referenceValidations: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									referenceId: { type: 'string' },
									accepted: { type: 'boolean' }
								},
								required: ['referenceId', 'accepted'],
								additionalProperties: false
							}
						}
					},
					required: ['candidateId', 'accepted', 'certainty', 'reason', 'referenceValidations'],
					additionalProperties: false
				}
			}
		},
		required: ['validations'],
		additionalProperties: false
	}
}

const parseSessionClaimValidations = (response: OpenAiResponse): SessionClaimValidation[] => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === sessionClaimValidationsTool.name
	)
	return call?.type === 'function_call'
		? sessionClaimValidationsSchema.parse(JSON.parse(call.arguments)).validations
		: []
}

const sessionClaimEvidenceRepairsSchema = z.object({
	repairs: z.array(
		z.object({
			candidateId: z.string().trim().min(1),
			evidence: z.array(evidenceRangeSchema).max(MAX_EVIDENCE_RANGES)
		})
	)
})

const sessionClaimEvidenceRepairsTool = {
	type: 'function' as const,
	name: 'repair_session_claim_evidence',
	description:
		'Repair only the transcript evidence line ranges for supplied candidate claims without rewriting claim content or metadata.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			repairs: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						candidateId: { type: 'string' },
						evidence: {
							type: 'array',
							items: evidenceRangeJsonSchema,
							maxItems: MAX_EVIDENCE_RANGES
						}
					},
					required: ['candidateId', 'evidence'],
					additionalProperties: false
				}
			}
		},
		required: ['repairs'],
		additionalProperties: false
	}
}

const parseSessionClaimEvidenceRepairs = (
	response: OpenAiResponse
): SessionClaimEvidenceRepair[] => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === sessionClaimEvidenceRepairsTool.name
	)
	return call?.type === 'function_call'
		? sessionClaimEvidenceRepairsSchema.parse(JSON.parse(call.arguments)).repairs
		: []
}

const sessionEntityResolutionSchema = z.discriminatedUnion('kind', [
	z.object({
		referenceId: z.string().trim().min(1),
		kind: z.literal('existing'),
		targetId: z.string().trim().min(1)
	}),
	z.object({
		referenceId: z.string().trim().min(1),
		kind: z.literal('create')
	}),
	z.object({
		referenceId: z.string().trim().min(1),
		kind: z.literal('defer'),
		candidateIds: z.array(z.string().trim().min(1)).min(1),
		reason: z.string().trim().min(1).max(240)
	})
])

const sessionEntityResolutionsSchema = z.object({
	resolutions: z.array(sessionEntityResolutionSchema)
})

const sessionEntityResolutionsTool = {
	type: 'function' as const,
	name: 'resolve_session_entities',
	description:
		'Resolve entity references explicitly as an existing supplied target, a new entity, or a genuine ambiguity among supplied identity candidates.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			resolutions: {
				type: 'array',
				items: {
					anyOf: [
						{
							type: 'object',
							properties: {
								referenceId: { type: 'string' },
								kind: { type: 'string', enum: ['existing'] },
								targetId: { type: 'string' }
							},
							required: ['referenceId', 'kind', 'targetId'],
							additionalProperties: false
						},
						{
							type: 'object',
							properties: {
								referenceId: { type: 'string' },
								kind: { type: 'string', enum: ['create'] }
							},
							required: ['referenceId', 'kind'],
							additionalProperties: false
						},
						{
							type: 'object',
							properties: {
								referenceId: { type: 'string' },
								kind: { type: 'string', enum: ['defer'] },
								candidateIds: {
									type: 'array',
									items: { type: 'string' },
									minItems: 1
								},
								reason: { type: 'string', minLength: 1, maxLength: 240 }
							},
							required: ['referenceId', 'kind', 'candidateIds', 'reason'],
							additionalProperties: false
						}
					]
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

const sessionEventAuditSchema = z.object({
	events: z.array(sessionClaimSchema),
	discardedEventIds: z.array(
		z.object({
			eventId: z.string().trim().min(1),
			reason: z.string().trim().min(1).max(240)
		})
	),
	duplicateGroups: z.array(
		z.object({
			canonicalEventId: z.string().trim().min(1),
			duplicateEventIds: z.array(z.string().trim().min(1)).min(1),
			reason: z.string().trim().min(1).max(240)
		})
	)
})

const sessionEventAuditTool = {
	type: 'function' as const,
	name: 'audit_session_events',
	description:
		'Record missing or corrected session events, unsupported extracted events, and duplicate event groups.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			events: { type: 'array', items: sessionClaimJsonSchema },
			discardedEventIds: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						eventId: { type: 'string' },
						reason: { type: 'string', minLength: 1, maxLength: 240 }
					},
					required: ['eventId', 'reason'],
					additionalProperties: false
				}
			},
			duplicateGroups: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						canonicalEventId: { type: 'string' },
						duplicateEventIds: {
							type: 'array',
							items: { type: 'string' },
							minItems: 1
						},
						reason: { type: 'string', minLength: 1, maxLength: 240 }
					},
					required: ['canonicalEventId', 'duplicateEventIds', 'reason'],
					additionalProperties: false
				}
			}
		},
		required: ['events', 'discardedEventIds', 'duplicateGroups'],
		additionalProperties: false
	}
}

const parseSessionEventAudit = (response: OpenAiResponse): SessionEventAudit => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === sessionEventAuditTool.name
	)
	return call?.type === 'function_call'
		? sessionEventAuditSchema.parse(JSON.parse(call.arguments))
		: { events: [], discardedEventIds: [], duplicateGroups: [] }
}

const sessionChronologySchema = z.object({
	relations: z.array(
		z.object({
			relation: z.enum(['before', 'during']),
			sourceEventId: z.string().trim().min(1),
			targetEventId: z.string().trim().min(1),
			certainty: z.enum(['explicit', 'inferred']),
			reason: z.string().trim().min(1).max(240)
		})
	),
	coverage: z.array(
		z.object({
			eventId: z.string().trim().min(1),
			status: z.enum(['connected', 'intentionally-unplaced']),
			reason: z.string().trim().min(1).max(240)
		})
	)
})

const sessionChronologyTool = {
	type: 'function' as const,
	name: 'record_session_chronology',
	description:
		'Record supported direct precedence and temporal-containment relationships between supplied new and existing campaign events.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			relations: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						relation: { type: 'string', enum: ['before', 'during'] },
						sourceEventId: { type: 'string' },
						targetEventId: { type: 'string' },
						certainty: { type: 'string', enum: ['explicit', 'inferred'] },
						reason: { type: 'string', minLength: 1, maxLength: 240 }
					},
					required: ['relation', 'sourceEventId', 'targetEventId', 'certainty', 'reason'],
					additionalProperties: false
				}
			},
			coverage: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						eventId: { type: 'string' },
						status: {
							type: 'string',
							enum: ['connected', 'intentionally-unplaced']
						},
						reason: { type: 'string', minLength: 1, maxLength: 240 }
					},
					required: ['eventId', 'status', 'reason'],
					additionalProperties: false
				}
			}
		},
		required: ['relations', 'coverage'],
		additionalProperties: false
	}
}

const parseSessionChronology = (response: OpenAiResponse): InferredSessionChronology => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === sessionChronologyTool.name
	)
	return call?.type === 'function_call'
		? sessionChronologySchema.parse(JSON.parse(call.arguments))
		: { relations: [], coverage: [] }
}

const campaignImportChronologySchema = z.object({
	relations: z.array(
		z.object({
			relation: z.enum(['before', 'during']),
			sourceEventId: z.string().trim().min(1),
			targetEventId: z.string().trim().min(1),
			certainty: z.enum(['explicit', 'inferred']),
			reason: z.string().trim().min(1).max(240),
			claimIds: z.array(z.string().trim().min(1)).min(1)
		})
	),
	coverage: sessionChronologySchema.shape.coverage
})

const campaignImportChronologyTool = {
	type: 'function' as const,
	name: 'record_campaign_import_chronology',
	description:
		'Record evidence-backed direct chronology relationships for committed campaign-import events.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			relations: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						relation: { type: 'string', enum: ['before', 'during'] },
						sourceEventId: { type: 'string' },
						targetEventId: { type: 'string' },
						certainty: { type: 'string', enum: ['explicit', 'inferred'] },
						reason: { type: 'string', minLength: 1, maxLength: 240 },
						claimIds: {
							type: 'array',
							items: { type: 'string', minLength: 1 },
							minItems: 1
						}
					},
					required: [
						'relation',
						'sourceEventId',
						'targetEventId',
						'certainty',
						'reason',
						'claimIds'
					],
					additionalProperties: false
				}
			},
			coverage: sessionChronologyTool.parameters.properties.coverage
		},
		required: ['relations', 'coverage'],
		additionalProperties: false
	}
}

const parseCampaignImportChronology = (
	response: OpenAiResponse
): InferredCampaignImportChronology => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === campaignImportChronologyTool.name
	)
	return call?.type === 'function_call'
		? campaignImportChronologySchema.parse(JSON.parse(call.arguments))
		: { relations: [], coverage: [] }
}

const relationshipLinksSchema = z.object({
	links: z.array(
		z.object({
			targetDocumentId: z.string().trim().min(1),
			relationship: z.string().trim().min(1)
		})
	)
})

const relationshipLinksTool = {
	type: 'function' as const,
	name: 'record_relationship_links',
	description:
		'Record current outgoing relationship links from the source entity to supplied candidate entities.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			links: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						targetDocumentId: { type: 'string' },
						relationship: { type: 'string' }
					},
					required: ['targetDocumentId', 'relationship'],
					additionalProperties: false
				}
			}
		},
		required: ['links'],
		additionalProperties: false
	}
}

const parseRelationshipLinks = (response: OpenAiResponse): RelationshipLink[] => {
	const call = response.output.find(
		(item) => item.type === 'function_call' && item.name === relationshipLinksTool.name
	)
	return call?.type === 'function_call'
		? relationshipLinksSchema.parse(JSON.parse(call.arguments)).links
		: []
}

const loreProposalSchema = z.object({
	title: z.string().trim().min(1).max(200),
	category: z.enum(loreDocumentTypes),
	content: z.string().trim().min(1).max(1_000_000)
})

const newLoreProposalTool = {
	type: 'function' as const,
	name: 'propose_new_lore',
	description:
		'Draft one new non-session campaign lore entry for the Dungeon Master to edit and explicitly approve. This tool never saves, edits, or applies canon.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			title: { type: 'string', minLength: 1, maxLength: 200 },
			category: { type: 'string', enum: loreDocumentTypes },
			content: { type: 'string', minLength: 1, maxLength: 1_000_000 }
		},
		required: ['title', 'category', 'content'],
		additionalProperties: false
	}
}

const requestInput = ({ system, prompt }: { system?: string; prompt: string }) => ({
	...(system ? { instructions: system } : {}),
	input: prompt
})

const parseLoreProposalCall = (item: OpenAiResponse['output'][number]) =>
	item.type === 'function_call' && item.name === newLoreProposalTool.name
		? loreProposalSchema.parse(JSON.parse(item.arguments))
		: undefined

const responseLoreProposal = (response: OpenAiResponse) =>
	response.output.map(parseLoreProposalCall).find((proposal) => proposal !== undefined)

export const parseAssistantResponse = (response: OpenAiResponse): AssistantGeneration => {
	const proposal = responseLoreProposal(response)

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
			event.name === newLoreProposalTool.name
		) {
			proposal = loreProposalSchema.parse(JSON.parse(event.arguments))
			continue
		}

		if (event.type === 'response.output_item.done') {
			proposal = parseLoreProposalCall(event.item) ?? proposal
			continue
		}

		if (event.type === 'response.completed') {
			proposal = responseLoreProposal(event.response) ?? proposal
			continue
		}

		if (event.type === 'error') {
			throw new Error(event.message)
		}

		if (event.type === 'response.failed') {
			throw new Error(event.response.error?.message ?? 'OpenAI response failed')
		}
	}

	if (!hasText) {
		yield {
			type: 'text-delta',
			delta: proposal
				? 'I drafted a lore suggestion for your review.'
				: 'I could not generate a response.'
		}
	}

	if (proposal) {
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
					tools: [newLoreProposalTool]
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
						tools: [newLoreProposalTool],
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

	validateSessionClaims: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [sessionClaimValidationsTool],
					tool_choice: { type: 'function', name: sessionClaimValidationsTool.name }
				})
				return parseSessionClaimValidations(response)
			},
			catch: (cause) => failure('ai', 'validateSessionClaims', cause)
		}),

	repairSessionClaimEvidence: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [sessionClaimEvidenceRepairsTool],
					tool_choice: { type: 'function', name: sessionClaimEvidenceRepairsTool.name }
				})
				return parseSessionClaimEvidenceRepairs(response)
			},
			catch: (cause) => failure('ai', 'repairSessionClaimEvidence', cause)
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
		}),

	auditSessionEvents: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [sessionEventAuditTool],
					tool_choice: { type: 'function', name: sessionEventAuditTool.name }
				})
				return parseSessionEventAudit(response)
			},
			catch: (cause) => failure('ai', 'auditSessionEvents', cause)
		}),

	inferSessionChronology: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [sessionChronologyTool],
					tool_choice: { type: 'function', name: sessionChronologyTool.name }
				})
				return parseSessionChronology(response)
			},
			catch: (cause) => failure('ai', 'inferSessionChronology', cause)
		}),

	inferCampaignImportChronology: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [campaignImportChronologyTool],
					tool_choice: { type: 'function', name: campaignImportChronologyTool.name }
				})
				return parseCampaignImportChronology(response)
			},
			catch: (cause) => failure('ai', 'inferCampaignImportChronology', cause)
		}),

	generateRelationshipLinks: ({ model, system, prompt }) =>
		tryPromise({
			try: async () => {
				const response = await client.responses.create({
					model,
					...requestInput({ system, prompt }),
					tools: [relationshipLinksTool],
					tool_choice: { type: 'function', name: relationshipLinksTool.name }
				})
				return parseRelationshipLinks(response)
			},
			catch: (cause) => failure('ai', 'generateRelationshipLinks', cause)
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
		validateSessionClaims: () => missingApiKey('validateSessionClaims'),
		repairSessionClaimEvidence: () => missingApiKey('repairSessionClaimEvidence'),
		resolveSessionEntities: () => missingApiKey('resolveSessionEntities'),
		auditSessionEvents: () => missingApiKey('auditSessionEvents'),
		inferSessionChronology: () => missingApiKey('inferSessionChronology'),
		inferCampaignImportChronology: () => missingApiKey('inferCampaignImportChronology'),
		generateRelationshipLinks: () => missingApiKey('generateRelationshipLinks')
	}
}
