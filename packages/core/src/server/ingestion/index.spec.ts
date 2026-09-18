import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type {
	AnalyzeSessionChunk,
	AuditSessionEvents,
	InferSessionChronology,
	ResolveSessionEntities,
	ValidateSessionClaims
} from '../ai/provider.js'
import type { VaultDocument } from '../vault/types.js'
import { sessionIngestion } from './index.js'
import type {
	ExtractedSessionClaim,
	InferredSessionChronology,
	SessionIngestionDraft,
	SessionIngestionSummary,
	SessionProposalResolution
} from './types.js'

const revision = {
	source: 'ingestion' as const,
	relatedSessionId: '',
	ingestionId: '',
	changeSummary: ''
}

type CreateInput = {
	documentId?: string
	path: string
	type: VaultDocument['type']
	after?: string[]
	during?: string[]
	eventForm?: VaultDocument['eventForm']
	content: string
	ingestionId?: string
	transcript?: string
	revision?: typeof revision
}

type UpdateInput = {
	type: VaultDocument['type']
	aliases?: string[]
	after?: string[]
	during?: string[]
	eventForm?: VaultDocument['eventForm']
	content: string
	expectedRevisionId: string
	revision?: typeof revision
}

const document = (
	id: string,
	title: string,
	aliases: string[] = [],
	type: VaultDocument['type'] = 'npc',
	overrides: Partial<VaultDocument> = {}
): VaultDocument => ({
	id,
	path: `${type === 'npc' ? 'NPCs' : 'Worldbuilding'}/${title}.md`,
	title,
	type,
	aliases,
	after: [],
	summary: '',
	content: `# ${title}`,
	links: [],
	currentRevisionId: `revision-${id}`,
	...overrides,
	during: overrides.during ?? []
})

const varek = document('varek', 'Varek', ['The Gatekeeper'])

const claim = (
	content: string,
	overrides: Partial<ExtractedSessionClaim> = {}
): ExtractedSessionClaim => ({
	kind: 'stable-fact',
	eventTitle: null,
	certainty: 'explicit',
	content,
	evidence: [{ startLine: 1, endLine: 1 }],
	entityReferences: [{ label: 'Varek', type: 'npc' }],
	...overrides
})

const validatingAnalyzer =
	(claims: ExtractedSessionClaim[]): AnalyzeSessionChunk =>
	() =>
		succeed(claims)

const acceptingValidator: ValidateSessionClaims = ({ prompt }) => {
	const candidates = JSON.parse(prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]') as {
		candidateId: string
		certainty: 'explicit' | 'inferred'
		entityReferences: { referenceId: string }[]
	}[]
	return succeed(
		candidates.map(({ candidateId, certainty, entityReferences }) => ({
			candidateId,
			accepted: true,
			certainty,
			referenceValidations: entityReferences.map(({ referenceId }) => ({
				referenceId,
				accepted: true
			}))
		}))
	)
}

const inferredChronology = (
	relations: InferredSessionChronology['relations'],
	coverage: InferredSessionChronology['coverage'] = []
) => succeed({ relations, coverage })

const setup = (
	claims: ExtractedSessionClaim[],
	documents: VaultDocument[] = [varek],
	resolveSessionEntities: ResolveSessionEntities = () => succeed([]),
	validateSessionClaims: ValidateSessionClaims = acceptingValidator,
	inferSessionChronology: InferSessionChronology = () => inferredChronology([]),
	auditSessionEvents: AuditSessionEvents = () =>
		succeed({ events: [], discardedEventIds: [], duplicateGroups: [] }),
	ingestionSummaries: SessionIngestionSummary[] = []
) => {
	let saved: SessionIngestionDraft | undefined
	let savedTranscript = ''
	const write = vi.fn((draft: SessionIngestionDraft, transcript: string) => {
		saved = draft
		savedTranscript = transcript
		return succeed(undefined)
	})
	const createDocument = vi.fn((_campaignId: string, input: CreateInput) =>
		succeed({
			id: input.documentId!,
			path: input.path,
			title: input.content.match(/^#\s+(.+)$/m)?.[1] ?? input.path,
			type: input.type,
			after: input.after ?? [],
			during: input.during ?? [],
			eventForm: input.eventForm,
			summary: '',
			content: input.content,
			links: [],
			currentRevisionId: `revision-${input.documentId}`
		} satisfies VaultDocument)
	)
	const updateDocument = vi.fn((_campaignId: string, documentId: string, input: UpdateInput) =>
		succeed({
			...(documents.find(({ id }) => id === documentId) ?? varek),
			content: input.content,
			currentRevisionId: `updated-${documentId}`
		})
	)
	const getDocuments = vi.fn(() => succeed(documents))
	const retrieveAnalysisDocuments = vi.fn(() => succeed(documents))
	const operations = sessionIngestion({
		ai: {
			analysisModel: 'analysis-model',
			analyzeSessionChunk: validatingAnalyzer(claims),
			validateSessionClaims,
			repairSessionClaimEvidence: () => succeed([]),
			resolveSessionEntities,
			auditSessionEvents,
			inferSessionChronology
		},
		storage: {
			write,
			read: () => succeed(saved!),
			readTranscript: () => succeed(savedTranscript),
			list: () => succeed(ingestionSummaries)
		},
		retrieveAnalysisDocuments,
		vault: {
			getDocuments,
			createDocument,
			updateDocument
		}
	})

	return {
		operations,
		createDocument,
		updateDocument,
		getDocuments,
		retrieveAnalysisDocuments,
		getSaved: () => saved
	}
}

const analyze = (
	operations: ReturnType<typeof setup>['operations'],
	transcript: string,
	title = 'Session 12'
) => operations.analyze({ campaignId: 'campaign', title, transcript })

const selectedIds = (draft: SessionIngestionDraft) =>
	draft.proposals.filter(({ selected }) => selected).map(({ proposalId }) => proposalId)

describe('session ingestion operations', () => {
	it('uses a caller-preallocated ingestion ID', async () => {
		const harness = setup([])
		const draft = await runPromise(
			harness.operations.analyze({
				ingestionId: 'preallocated-ingestion',
				campaignId: 'campaign',
				title: 'Session 12',
				transcript: 'The party rested.'
			})
		)

		expect(draft.ingestionId).toBe('preallocated-ingestion')
	})

	it('lists only ingestions without a committed session document', async () => {
		const pending = {
			ingestionId: 'pending-ingestion',
			campaignId: 'campaign',
			title: 'Pending session',
			createdAt: '2026-09-18T09:00:00.000Z',
			phase: 'review',
			canDiscard: true
		} satisfies SessionIngestionSummary
		const completed = {
			...pending,
			ingestionId: 'completed-ingestion',
			title: 'Completed session'
		} satisfies SessionIngestionSummary
		const completedDocument = document('completed-session', 'Completed session', [], 'session', {
			ingestionId: completed.ingestionId
		})
		const harness = setup(
			[],
			[varek, completedDocument],
			undefined,
			undefined,
			undefined,
			undefined,
			[pending, completed]
		)

		expect(await runPromise(harness.operations.listUncommitted('campaign'))).toEqual([pending])
	})

	it('retrieves bounded analysis documents only after audited claims exist', async () => {
		const harness = setup([
			claim('Varek opened the western gate.', {
				kind: 'development',
				eventTitle: 'Western gate opened',
				entityReferences: [{ label: 'Varek', type: 'npc' }]
			})
		])

		await runPromise(
			analyze(
				harness.operations,
				'Unrelated table chatter that is not part of any audited claim.\nVarek opened the western gate.'
			)
		)

		expect(harness.getDocuments).not.toHaveBeenCalled()
		expect(harness.retrieveAnalysisDocuments).toHaveBeenCalledOnce()
		expect(harness.retrieveAnalysisDocuments).toHaveBeenCalledWith(
			'campaign',
			expect.arrayContaining([
				expect.objectContaining({
					content: 'Varek opened the western gate.',
					eventTitle: 'Western gate opened',
					entityReferences: [{ label: 'Varek', type: 'npc' }]
				})
			])
		)
		expect(harness.retrieveAnalysisDocuments.mock.calls[0]?.[1]).not.toContainEqual(
			expect.objectContaining({ content: expect.stringContaining('Unrelated table chatter') })
		)
	})

	it('updates a deterministically resolved entity and records revision metadata', async () => {
		const harness = setup([
			claim('The Gatekeeper opened the gate.', {
				content: 'Varek opened the western gate.',
				evidence: [{ startLine: 2, endLine: 2 }],
				entityReferences: [{ label: 'The Gatekeeper', type: 'npc' }]
			})
		])
		const transcript = 'GM: The party waits.\nThe Gatekeeper opened the gate.'
		const draft = await runPromise(analyze(harness.operations, transcript))

		expect(harness.getSaved()).toEqual(draft)
		expect(draft.proposals).toHaveLength(2)
		expect(draft.proposals[1]).toMatchObject({
			operation: 'update-canon',
			selected: true,
			resolutionMethod: 'deterministic',
			match: { kind: 'exact', documentId: 'varek' },
			base: { documentId: 'varek', revisionId: 'revision-varek' }
		})

		const result = await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)

		expect(harness.createDocument).toHaveBeenCalledWith(
			'campaign',
			expect.objectContaining({
				documentId: result.sessionDocumentId,
				path: 'Sessions/session-12.md',
				type: 'session',
				content: '# Session 12\n\nVarek opened the western gate.',
				ingestionId: draft.ingestionId,
				transcript
			})
		)
		expect(harness.updateDocument).toHaveBeenCalledWith(
			'campaign',
			'varek',
			expect.objectContaining({
				content: '# Varek\n\nVarek opened the western gate.\n',
				expectedRevisionId: 'revision-varek',
				revision: expect.objectContaining({
					source: 'ingestion',
					relatedSessionId: result.sessionDocumentId,
					ingestionId: draft.ingestionId
				})
			})
		)
	})

	it('resolves a short unambiguous name to an existing full entity name', async () => {
		const mara = document('mara', 'Mara Vale')
		const harness = setup(
			[
				claim('Mara is about forty.', {
					content: 'Mara is about forty years old.',
					entityReferences: [{ label: 'Mara', type: 'npc' }]
				})
			],
			[mara]
		)
		const draft = await runPromise(analyze(harness.operations, 'Mara is about forty.'))

		expect(draft.proposals[1]).toMatchObject({
			operation: 'update-canon',
			title: 'Mara Vale',
			selected: true,
			match: { kind: 'exact', documentId: 'mara' }
		})
	})

	it('never turns a property phrase into a new entity', async () => {
		const mara = document('mara', 'Mara Vale')
		const harness = setup(
			[
				claim("Mara's age is about forty.", {
					content: 'Mara is about forty years old.',
					entityReferences: [{ label: "Mara's age", type: 'npc' }]
				})
			],
			[mara]
		)
		const draft = await runPromise(analyze(harness.operations, "Mara's age is about forty."))
		const proposal = draft.proposals[1]

		expect(proposal).toMatchObject({
			operation: 'create-entity',
			title: "Mara's age",
			selected: false,
			canCreate: false,
			match: {
				kind: 'unresolved',
				candidates: [expect.objectContaining({ documentId: 'mara', title: 'Mara Vale' })]
			}
		})
	})

	it('groups facts for the same newly introduced named entity', async () => {
		const harness = setup(
			[
				claim('Mara Vale knows the old road.', {
					content: 'Mara Vale knows the old road.',
					entityReferences: [{ label: 'Mara Vale', type: 'npc' }]
				}),
				claim('Mara Vale carries a blue lantern.', {
					content: 'Mara Vale carries a blue lantern.',
					entityReferences: [{ label: 'Mara Vale', type: 'npc' }]
				})
			],
			[]
		)
		const draft = await runPromise(
			analyze(
				harness.operations,
				'Mara Vale knows the old road.\nMara Vale carries a blue lantern.'
			)
		)
		const entity = draft.proposals.find(({ documentType }) => documentType === 'npc')!

		expect(draft.proposals).toHaveLength(2)
		expect(entity).toMatchObject({
			operation: 'create-entity',
			title: 'Mara Vale',
			selected: true,
			resolutionMethod: 'deterministic'
		})
		expect(entity.claimIds).toHaveLength(2)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)
		const entityCreate = harness.createDocument.mock.calls.find(
			([, input]) => input.type === 'npc'
		)?.[1]
		expect(entityCreate).toMatchObject({
			path: 'NPCs/mara-vale.md',
			content: '# Mara Vale\n\nMara Vale knows the old road.\n\nMara Vale carries a blue lantern.'
		})
	})

	it('normalizes malformed new entity labels into display-ready document titles', async () => {
		const harness = setup(
			[
				claim('The service tunnels below Cathedral Square are old.', {
					content: 'The service tunnels below Cathedral Square are old.',
					entityReferences: [{ label: 'service tunnels below Cathedral Square', type: 'location' }]
				})
			],
			[]
		)
		const draft = await runPromise(
			analyze(harness.operations, 'The service tunnels below Cathedral Square are old.')
		)
		const location = draft.proposals.find(({ documentType }) => documentType === 'location')!

		expect(location).toMatchObject({
			operation: 'create-entity',
			title: 'Service tunnels below Cathedral Square',
			selected: true
		})

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)
		const locationCreate = harness.createDocument.mock.calls.find(
			([, input]) => input.type === 'location'
		)?.[1]
		expect(locationCreate).toMatchObject({
			path: 'Locations/service-tunnels-below-cathedral-square.md',
			content:
				'# Service tunnels below Cathedral Square\n\nThe service tunnels below Cathedral Square are old.'
		})
	})

	it('uses a batched contextual resolver for relational references', async () => {
		const elias = document('elias', 'Elias Vey', [], 'npc', {
			content: '# Elias Vey\n\nHis father was [[Roger]].',
			links: ['Roger']
		})
		const roger = document('roger', 'Roger')
		const resolver: ResolveSessionEntities = vi.fn(({ prompt }) => {
			const input = JSON.parse(prompt) as {
				references: { referenceId: string; candidates: { targetId: string }[] }[]
			}
			return succeed(
				input.references.map(({ referenceId, candidates }) => ({
					referenceId,
					targetId:
						candidates.find(({ targetId }) => targetId === 'document:roger')?.targetId ?? null
				}))
			)
		})
		const harness = setup(
			[
				claim("Elias' father warned him about the gate.", {
					entityReferences: [{ label: "Elias' father", type: 'npc' }]
				})
			],
			[elias, roger],
			resolver
		)
		const draft = await runPromise(
			analyze(harness.operations, "Elias' father warned him about the gate.")
		)
		const proposal = draft.proposals[1]

		expect(resolver).toHaveBeenCalledTimes(1)
		expect(proposal).toMatchObject({
			operation: 'update-canon',
			title: 'Roger',
			selected: false,
			resolutionMethod: 'model',
			match: { kind: 'exact', documentId: 'roger' }
		})
	})

	it('creates a Worldbuilding entry for a durable setting concept', async () => {
		const harness = setup(
			[
				claim('The Thirteen-Tone Sequence can communicate with the presence below Greyhaven.', {
					content: 'The Thirteen-Tone Sequence can communicate with the presence below Greyhaven.',
					entityReferences: [{ label: 'Thirteen-Tone Sequence', type: 'worldbuilding' }]
				})
			],
			[]
		)
		const transcript =
			'The Thirteen-Tone Sequence can communicate with the presence below Greyhaven.'
		const draft = await runPromise(analyze(harness.operations, transcript))
		const proposal = draft.proposals[1]

		expect(proposal).toMatchObject({
			operation: 'create-entity',
			documentType: 'worldbuilding',
			title: 'Thirteen-Tone Sequence',
			selected: true,
			canCreate: true
		})

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)
		expect(harness.createDocument).toHaveBeenCalledWith(
			'campaign',
			expect.objectContaining({
				path: 'Worldbuilding/thirteen-tone-sequence.md',
				type: 'worldbuilding',
				content:
					'# Thirteen-Tone Sequence\n\nThe Thirteen-Tone Sequence can communicate with the presence below Greyhaven.'
			})
		)
	})

	it('keeps an orphan world fact in the session without inventing a Worldbuilding entry', async () => {
		const harness = setup(
			[
				claim('Four bells have now been found.', {
					content: 'Four bells have now been found.',
					entityReferences: []
				})
			],
			[]
		)
		const draft = await runPromise(analyze(harness.operations, 'Four bells have now been found.'))
		const record = draft.proposals[1]

		expect(record).toMatchObject({ operation: 'record-only', selected: true })

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)
		expect(harness.createDocument).toHaveBeenCalledTimes(1)
		expect(harness.createDocument.mock.calls[0]?.[1]).toMatchObject({
			type: 'session',
			content: '# Session 12\n\nFour bells have now been found.'
		})
	})

	it('creates developments as events only after claim validation', async () => {
		const harness = setup(
			[
				claim('Mara hired the party to recover the lockbox.', {
					kind: 'development',
					eventTitle: 'Mara hires party for lockbox',
					entityReferences: [{ label: 'Mara', type: 'npc' }]
				})
			],
			[]
		)
		const draft = await runPromise(
			analyze(harness.operations, 'Mara hired the party to recover the lockbox.')
		)
		const event = draft.proposals[1]

		expect(event).toMatchObject({
			operation: 'create-event',
			documentType: 'event',
			title: 'Mara hires party for lockbox',
			content: 'Mara hired the party to recover the lockbox.',
			selected: true
		})
	})

	it('recovers a missing durable event and validates it before creating a proposal', async () => {
		const auditSessionEvents: AuditSessionEvents = vi.fn(({ prompt, system }) => {
			expect(system).toContain('Captures, rescues, deaths, discoveries')
			expect(prompt).toContain('Party enters aqueduct')
			return succeed({
				events: [
					claim('The party captured Raska at the aqueduct.', {
						kind: 'development',
						eventTitle: 'Party captures Raska',
						evidence: [{ startLine: 2, endLine: 2 }],
						entityReferences: [{ label: 'Raska', type: 'npc' }]
					})
				],
				discardedEventIds: [],
				duplicateGroups: []
			})
		})
		const harness = setup(
			[
				claim('The party entered the aqueduct.', {
					kind: 'development',
					eventTitle: 'Party enters aqueduct',
					entityReferences: []
				})
			],
			[],
			() => succeed([]),
			acceptingValidator,
			() => inferredChronology([]),
			auditSessionEvents
		)

		const draft = await runPromise(
			analyze(
				harness.operations,
				'The party entered the aqueduct.\nThe party captured Raska at the aqueduct.'
			)
		)

		expect(auditSessionEvents).toHaveBeenCalledTimes(1)
		expect(
			draft.proposals
				.filter(({ operation }) => operation === 'create-event')
				.map(({ title }) => title)
		).toEqual(['Party enters aqueduct', 'Party captures Raska'])
	})

	it('collapses duplicate events and replaces an overstated outcome', async () => {
		const auditSessionEvents: AuditSessionEvents = ({ prompt }) => {
			const events = JSON.parse(
				prompt.split('## Validated development events\n').at(-1) ?? '[]'
			) as { eventId: string; title: string }[]
			const crown = events.find(({ title }) => title === 'Crown removed')!
			const duplicateCrown = events.find(({ title }) => title === 'Crown removed during reversal')!
			const escape = events.find(({ title }) => title === 'Vaska escapes')!
			return succeed({
				events: [
					claim('Vaska fell toward a lower ledge and vanished into spray and darkness.', {
						kind: 'development',
						eventTitle: 'Vaska disappears into darkness',
						evidence: [{ startLine: 3, endLine: 3 }],
						entityReferences: [{ label: 'Vaska', type: 'npc' }]
					})
				],
				discardedEventIds: [
					{ eventId: escape.eventId, reason: 'The transcript does not establish an escape.' }
				],
				duplicateGroups: [
					{
						canonicalEventId: crown.eventId,
						duplicateEventIds: [duplicateCrown.eventId],
						reason: 'Both events describe Brakka removing the same crown.'
					}
				]
			})
		}
		const transcript =
			'Brakka removed the crown.\nBrakka tore it free as the ritual reversed.\nVaska fell toward a lower ledge and vanished into spray and darkness.'
		const harness = setup(
			[
				claim('Brakka removed the crown.', {
					kind: 'development',
					eventTitle: 'Crown removed',
					evidence: [{ startLine: 1, endLine: 1 }],
					entityReferences: []
				}),
				claim('Brakka tore the crown free as the ritual reversed.', {
					kind: 'development',
					eventTitle: 'Crown removed during reversal',
					evidence: [{ startLine: 2, endLine: 2 }],
					entityReferences: []
				}),
				claim('Vaska escaped from the collapsing bridge.', {
					kind: 'development',
					eventTitle: 'Vaska escapes',
					evidence: [{ startLine: 3, endLine: 3 }],
					entityReferences: [{ label: 'Vaska', type: 'npc' }]
				})
			],
			[],
			() => succeed([]),
			acceptingValidator,
			() => inferredChronology([]),
			auditSessionEvents
		)

		const draft = await runPromise(analyze(harness.operations, transcript))
		const events = draft.proposals.filter(({ operation }) => operation === 'create-event')

		expect(events.map(({ title }) => title)).toEqual([
			'Crown removed',
			'Vaska disappears into darkness'
		])
		expect(events[0]?.evidence.map(({ startLine }) => startLine)).toEqual([1, 2])
		expect(draft.warnings.some((warning) => warning.includes('Event discarded by audit'))).toBe(
			true
		)
	})

	it('infers reviewed chronology and persists event predecessors', async () => {
		const inferSessionChronology: InferSessionChronology = vi.fn(({ prompt, system }) => {
			expect(system).toContain('complete transitive reduction')
			expect(system).toContain('not a sample of representative relationships')
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			return inferredChronology(
				[
					{
						relation: 'before' as const,
						sourceEventId: events[0]!.eventId,
						targetEventId: events[1]!.eventId,
						certainty: 'explicit' as const,
						reason: 'The party crossed the bridge before opening the gate.'
					}
				],
				events.map(({ eventId }) => ({
					eventId,
					status: 'connected' as const,
					reason: 'The event participates in the supported session sequence.'
				}))
			)
		})
		const harness = setup(
			[
				claim('The party crossed the bridge.', {
					kind: 'development',
					eventTitle: 'Party crosses bridge',
					evidence: [{ startLine: 1, endLine: 1 }],
					entityReferences: []
				}),
				claim('The party then opened the gate.', {
					kind: 'development',
					eventTitle: 'Party opens gate',
					evidence: [{ startLine: 2, endLine: 2 }],
					entityReferences: []
				})
			],
			[],
			() => succeed([]),
			acceptingValidator,
			inferSessionChronology
		)
		const draft = await runPromise(
			analyze(harness.operations, 'The party crossed the bridge.\nThe party then opened the gate.')
		)

		expect(inferSessionChronology).toHaveBeenCalledTimes(1)
		expect(draft.chronology).toEqual([
			expect.objectContaining({
				relation: 'before',
				source: expect.objectContaining({
					eventId: draft.proposals[1]!.proposalId,
					source: 'proposal'
				}),
				target: expect.objectContaining({
					eventId: draft.proposals[2]!.proposalId,
					source: 'proposal'
				}),
				certainty: 'explicit',
				selected: true
			})
		])
		expect(draft.chronologyCoverage.map(({ status }) => status)).toEqual(['connected', 'connected'])

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft),
				selectedChronologyIds: draft.chronology.map(({ chronologyId }) => chronologyId)
			})
		)

		const eventCreates = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.filter(({ type }) => type === 'event')
		expect(eventCreates).toHaveLength(2)
		expect(eventCreates[0]!.after).toEqual([])
		expect(eventCreates[1]!.after).toEqual([eventCreates[0]!.documentId])
	})

	it('creates new events in topological order even when proposals are reversed', async () => {
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			return inferredChronology([
				{
					relation: 'before' as const,
					sourceEventId: events[1]!.eventId,
					targetEventId: events[0]!.eventId,
					certainty: 'explicit' as const,
					reason: 'The earlier event precedes the later event.'
				}
			])
		}
		const harness = setup(
			[
				claim('The later event happened.', {
					kind: 'development',
					eventTitle: 'Later event',
					entityReferences: []
				}),
				claim('The earlier event had happened first.', {
					kind: 'development',
					eventTitle: 'Earlier event',
					entityReferences: []
				})
			],
			[],
			() => succeed([]),
			acceptingValidator,
			inferSessionChronology
		)
		const draft = await runPromise(
			analyze(harness.operations, 'The later event happened. The earlier event had happened first.')
		)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft),
				selectedChronologyIds: draft.chronology.map(({ chronologyId }) => chronologyId)
			})
		)

		const eventCreates = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.filter(({ type }) => type === 'event')
		expect(eventCreates.map(({ content }) => content)).toEqual([
			expect.stringContaining('# Earlier event'),
			expect.stringContaining('# Later event')
		])
		expect(eventCreates[1]!.after).toEqual([eventCreates[0]!.documentId])
	})

	it('uses the full transcript and anchors a new session event after existing chronology', async () => {
		const previous = document('previous-session', 'Party escapes Blackwater', [], 'event', {
			summary: 'The party escaped the flooded tunnels and returned to Greyhaven.'
		})
		const transcript =
			'The party reflects on escaping Blackwater.\nLater that morning, they enter the Crooked Lantern.'
		const inferSessionChronology: InferSessionChronology = vi.fn(({ prompt }) => {
			expect(prompt).toContain(`## Full numbered transcript\n1 | ${transcript.split('\n')[0]}`)
			expect(prompt).toContain(`2 | ${transcript.split('\n')[1]}`)
			expect(prompt).toContain('Party escapes Blackwater')
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			return inferredChronology([
				{
					relation: 'before' as const,
					sourceEventId: previous.id,
					targetEventId: events[0]!.eventId,
					certainty: 'explicit' as const,
					reason: 'The session continues after the party escaped Blackwater.'
				}
			])
		})
		const harness = setup(
			[
				claim('The party entered the Crooked Lantern.', {
					kind: 'development',
					eventTitle: 'Party enters Crooked Lantern',
					evidence: [{ startLine: 2, endLine: 2 }],
					entityReferences: []
				})
			],
			[previous],
			() => succeed([]),
			acceptingValidator,
			inferSessionChronology
		)
		const draft = await runPromise(analyze(harness.operations, transcript))

		expect(draft.chronology[0]).toMatchObject({
			source: { eventId: previous.id, title: previous.title, source: 'existing' },
			target: { source: 'proposal' }
		})

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft),
				selectedChronologyIds: draft.chronology.map(({ chronologyId }) => chronologyId)
			})
		)

		const eventCreate = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.find(({ type }) => type === 'event')
		expect(eventCreate?.after).toEqual([previous.id])
	})

	it('can place a new historical event before an existing historical event', async () => {
		const founding = document('kingdom-founded', 'Kingdom of Edrath founded', [], 'event', {
			after: ['older-history'],
			summary: 'Edrath was founded after the Goblin Wars.'
		})
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			return inferredChronology([
				{
					relation: 'before' as const,
					sourceEventId: events[0]!.eventId,
					targetEventId: founding.id,
					certainty: 'explicit' as const,
					reason: 'The account dates the Goblin Wars before the founding of Edrath.'
				}
			])
		}
		const harness = setup(
			[
				claim('The Goblin Wars ended five hundred years ago, before Edrath was founded.', {
					kind: 'development',
					eventTitle: 'Goblin Wars end',
					entityReferences: []
				})
			],
			[founding],
			() => succeed([]),
			acceptingValidator,
			inferSessionChronology
		)
		const draft = await runPromise(
			analyze(
				harness.operations,
				'The Goblin Wars ended five hundred years ago, before Edrath was founded.'
			)
		)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft),
				selectedChronologyIds: draft.chronology.map(({ chronologyId }) => chronologyId)
			})
		)

		const eventCreate = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.find(({ type }) => type === 'event')!
		expect(harness.updateDocument).toHaveBeenCalledWith(
			'campaign',
			founding.id,
			expect.objectContaining({
				after: ['older-history', eventCreate.documentId],
				expectedRevisionId: founding.currentRevisionId
			})
		)
	})

	it('contains unordered events within an existing occurrence and promotes it to a period', async () => {
		const goblinWars = document('goblin-wars', 'The Goblin Wars', [], 'event', {
			eventForm: 'occurrence',
			summary: 'A war fought five hundred years ago.'
		})
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			expect(prompt).toContain('"eventForm": "occurrence"')
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			return inferredChronology(
				events.map(({ eventId }) => ({
					relation: 'during' as const,
					sourceEventId: eventId,
					targetEventId: goblinWars.id,
					certainty: 'explicit' as const,
					reason: 'The account says this happened during the Goblin Wars.'
				}))
			)
		}
		const claims = [
			claim('The Battle of Red Pass happened during the Goblin Wars.', {
				kind: 'development',
				eventTitle: 'Battle of Red Pass',
				evidence: [{ startLine: 1, endLine: 1 }],
				entityReferences: []
			}),
			claim('The Siege of Dunmar happened during the Goblin Wars.', {
				kind: 'development',
				eventTitle: 'Siege of Dunmar',
				evidence: [{ startLine: 2, endLine: 2 }],
				entityReferences: []
			})
		]
		const harness = setup(
			claims,
			[goblinWars],
			() => succeed([]),
			acceptingValidator,
			inferSessionChronology
		)
		const draft = await runPromise(
			analyze(harness.operations, claims.map(({ content }) => content).join('\n'))
		)

		expect(draft.chronology).toHaveLength(2)
		expect(draft.chronology).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					relation: 'during',
					source: expect.objectContaining({ source: 'proposal' }),
					target: expect.objectContaining({ eventId: goblinWars.id, source: 'existing' })
				})
			])
		)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft),
				selectedChronologyIds: draft.chronology.map(({ chronologyId }) => chronologyId)
			})
		)

		const eventCreates = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.filter(({ type }) => type === 'event')
		expect(eventCreates).toHaveLength(2)
		for (const event of eventCreates) {
			expect(event.after).toEqual([])
			expect(event.during).toEqual([goblinWars.id])
			expect(event.eventForm).toBe('occurrence')
		}
		expect(harness.updateDocument).toHaveBeenCalledWith(
			'campaign',
			goblinWars.id,
			expect.objectContaining({
				after: [],
				during: [],
				eventForm: 'period',
				expectedRevisionId: goblinWars.currentRevisionId
			})
		)
	})

	it('creates a newly discovered period before the event contained by it', async () => {
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
				title: string
			}[]
			const battle = events.find(({ title }) => title === 'Battle of Red Pass')!
			const war = events.find(({ title }) => title === 'The Goblin Wars')!
			return inferredChronology([
				{
					relation: 'during' as const,
					sourceEventId: battle.eventId,
					targetEventId: war.eventId,
					certainty: 'explicit' as const,
					reason: 'The battle occurred during the war.'
				}
			])
		}
		const harness = setup(
			[
				claim('The Battle of Red Pass happened during the Goblin Wars.', {
					kind: 'development',
					eventTitle: 'Battle of Red Pass',
					entityReferences: []
				}),
				claim('The Goblin Wars devastated the eastern kingdoms.', {
					kind: 'development',
					eventTitle: 'The Goblin Wars',
					entityReferences: []
				})
			],
			[],
			() => succeed([]),
			acceptingValidator,
			inferSessionChronology
		)
		const draft = await runPromise(
			analyze(
				harness.operations,
				'The Battle of Red Pass happened during the Goblin Wars.\nThe Goblin Wars devastated the eastern kingdoms.'
			)
		)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft),
				selectedChronologyIds: draft.chronology.map(({ chronologyId }) => chronologyId)
			})
		)

		const eventCreates = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.filter(({ type }) => type === 'event')
		const [war, battle] = eventCreates
		expect(war!.content).toContain('# The Goblin Wars')
		expect(war!.eventForm).toBe('period')
		expect(battle!.content).toContain('# Battle of Red Pass')
		expect(battle!.during).toEqual([war!.documentId])
		expect(battle!.after).toEqual([])
	})

	it('validates new anchors against the existing campaign graph', async () => {
		const earlier = document('earlier', 'Siege begins', [], 'event')
		const later = document('later', 'Siege ends', [], 'event', { after: [earlier.id] })
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			const [event] = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			return inferredChronology([
				{
					relation: 'before' as const,
					sourceEventId: later.id,
					targetEventId: event!.eventId,
					certainty: 'explicit' as const,
					reason: 'The new event follows the siege.'
				},
				{
					relation: 'before' as const,
					sourceEventId: event!.eventId,
					targetEventId: earlier.id,
					certainty: 'explicit' as const,
					reason: 'This would create a cycle.'
				},
				{
					relation: 'before' as const,
					sourceEventId: earlier.id,
					targetEventId: later.id,
					certainty: 'explicit' as const,
					reason: 'Existing-only relationships are outside this ingestion.'
				}
			])
		}
		const harness = setup(
			[
				claim('The party visits the abandoned battlefield.', {
					kind: 'development',
					eventTitle: 'Party visits battlefield',
					entityReferences: []
				})
			],
			[earlier, later],
			() => succeed([]),
			acceptingValidator,
			inferSessionChronology
		)
		const draft = await runPromise(
			analyze(harness.operations, 'The party visits the abandoned battlefield.')
		)

		expect(draft.chronology).toHaveLength(1)
		expect(draft.chronology[0]).toMatchObject({
			source: { eventId: later.id, source: 'existing' },
			target: { source: 'proposal' }
		})
		expect(draft.warnings.some((warning) => warning.includes('[precedence-cycle]'))).toBe(true)
		expect(draft.warnings.some((warning) => warning.includes('[invalid-reference]'))).toBe(true)
	})

	it('preserves a branch of mutually unordered events with common boundaries', async () => {
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			const [arrival, warning, north, east, south, departure] = events
			const relationship = (sourceEventId: string, targetEventId: string) => ({
				relation: 'before' as const,
				sourceEventId,
				targetEventId,
				certainty: 'explicit' as const,
				reason: 'The transcript establishes this boundary.'
			})

			return inferredChronology([
				relationship(arrival!.eventId, warning!.eventId),
				relationship(warning!.eventId, north!.eventId),
				relationship(warning!.eventId, east!.eventId),
				relationship(warning!.eventId, south!.eventId),
				relationship(north!.eventId, departure!.eventId),
				relationship(east!.eventId, departure!.eventId),
				relationship(south!.eventId, departure!.eventId)
			])
		}
		const titles = [
			'Party arrives',
			'Warning sounds',
			'North tower secured',
			'East gate secured',
			'South crypt secured',
			'Party departs'
		]
		const claims = titles.map((title, index) =>
			claim(`${title}.`, {
				kind: 'development',
				eventTitle: title,
				evidence: [{ startLine: index + 1, endLine: index + 1 }],
				entityReferences: []
			})
		)
		const harness = setup(claims, [], () => succeed([]), acceptingValidator, inferSessionChronology)
		const draft = await runPromise(
			analyze(harness.operations, claims.map(({ content }) => content).join('\n'))
		)
		const eventProposalIds = draft.proposals
			.filter(({ operation }) => operation === 'create-event')
			.map(({ proposalId }) => proposalId)
		const siblingIds = new Set(eventProposalIds.slice(2, 5))

		expect(draft.chronology).toHaveLength(7)
		expect(
			draft.chronology.some(
				({ source, target }) => siblingIds.has(source.eventId) && siblingIds.has(target.eventId)
			)
		).toBe(false)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft),
				selectedChronologyIds: draft.chronology.map(({ chronologyId }) => chronologyId)
			})
		)

		const eventCreates = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.filter(({ type }) => type === 'event')
		const [arrival, warning, north, east, south, departure] = eventCreates
		expect(arrival!.after).toEqual([])
		expect(warning!.after).toEqual([arrival!.documentId])
		expect(north!.after).toEqual([warning!.documentId])
		expect(east!.after).toEqual([warning!.documentId])
		expect(south!.after).toEqual([warning!.documentId])
		expect(departure!.after).toHaveLength(3)
		expect(departure!.after).toEqual(
			expect.arrayContaining([north!.documentId, east!.documentId, south!.documentId])
		)
	})

	it('does not add a fallback order when chronology is unknown', async () => {
		const claims = ['First account', 'Second account', 'Third account'].map((title, index) =>
			claim(`${title}.`, {
				kind: 'development',
				eventTitle: title,
				evidence: [{ startLine: index + 1, endLine: index + 1 }],
				entityReferences: []
			})
		)
		const harness = setup(
			claims,
			[],
			() => succeed([]),
			acceptingValidator,
			({ prompt }) => {
				const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
					eventId: string
				}[]
				return inferredChronology(
					[],
					events.map(({ eventId }) => ({
						eventId,
						status: 'intentionally-unplaced' as const,
						reason: 'The accounts have no established relative order.'
					}))
				)
			}
		)
		const draft = await runPromise(
			analyze(harness.operations, claims.map(({ content }) => content).join('\n'))
		)

		expect(draft.chronology).toEqual([])
		expect(draft.chronologyCoverage).toHaveLength(3)
		expect(
			draft.chronologyCoverage.every(({ status }) => status === 'intentionally-unplaced')
		).toBe(true)
	})

	it('surfaces an event omitted from chronology coverage', async () => {
		const claims = ['Arrival', 'Departure'].map((title, index) =>
			claim(`${title}.`, {
				kind: 'development',
				eventTitle: title,
				evidence: [{ startLine: index + 1, endLine: index + 1 }],
				entityReferences: []
			})
		)
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			return inferredChronology(
				[],
				[
					{
						eventId: events[0]!.eventId,
						status: 'intentionally-unplaced',
						reason: 'No relative order is established.'
					}
				]
			)
		}
		const harness = setup(claims, [], () => succeed([]), acceptingValidator, inferSessionChronology)

		const draft = await runPromise(analyze(harness.operations, 'Arrival.\nDeparture.'))

		expect(draft.chronologyCoverage.map(({ status }) => status)).toEqual([
			'intentionally-unplaced',
			'missing'
		])
		expect(draft.warnings.some((warning) => warning.includes('coverage missing'))).toBe(true)
	})

	it('drops cyclic and transitively redundant chronology relationships', async () => {
		const inferSessionChronology: InferSessionChronology = ({ prompt }) => {
			const events = JSON.parse(prompt.split('## Candidate events\n').at(-1) ?? '[]') as {
				eventId: string
			}[]
			const [first, second, third] = events
			return inferredChronology([
				{
					relation: 'before',
					sourceEventId: first!.eventId,
					targetEventId: second!.eventId,
					certainty: 'inferred',
					reason: 'Narrative progression.'
				},
				{
					relation: 'before',
					sourceEventId: second!.eventId,
					targetEventId: third!.eventId,
					certainty: 'inferred',
					reason: 'Narrative progression.'
				},
				{
					relation: 'before',
					sourceEventId: first!.eventId,
					targetEventId: third!.eventId,
					certainty: 'inferred',
					reason: 'Redundant transitive relationship.'
				},
				{
					relation: 'before',
					sourceEventId: third!.eventId,
					targetEventId: first!.eventId,
					certainty: 'explicit',
					reason: 'Invalid cycle.'
				}
			])
		}
		const claims = ['First', 'Second', 'Third'].map((title, index) =>
			claim(`${title} event.`, {
				kind: 'development',
				eventTitle: `${title} event`,
				evidence: [{ startLine: index + 1, endLine: index + 1 }],
				entityReferences: []
			})
		)
		const harness = setup(claims, [], () => succeed([]), acceptingValidator, inferSessionChronology)
		const draft = await runPromise(
			analyze(harness.operations, 'First event.\nSecond event.\nThird event.')
		)

		expect(draft.chronology).toHaveLength(2)
		expect(draft.chronology.every(({ selected }) => !selected)).toBe(true)
		expect(draft.warnings.some((warning) => warning.includes('[precedence-cycle]'))).toBe(true)
	})

	it('lets a reviewer resolve an ambiguous mention to an existing entity', async () => {
		const mara = document('mara', 'Mara Vale')
		const edric = document('edric', 'Brother Edric Vale')
		const harness = setup(
			[
				claim('Vale carried the letter.', {
					entityReferences: [{ label: 'Vale', type: 'npc' }]
				})
			],
			[mara, edric]
		)
		const draft = await runPromise(analyze(harness.operations, 'Vale carried the letter.'))
		const session = draft.proposals[0]
		const proposal = draft.proposals[1]

		expect(proposal).toMatchObject({
			selected: false,
			match: {
				kind: 'unresolved',
				candidates: expect.arrayContaining([
					expect.objectContaining({ documentId: 'mara' }),
					expect.objectContaining({ documentId: 'edric' })
				])
			}
		})

		const missingResolution = await runPromise(
			flip(
				harness.operations.commit({
					campaignId: draft.campaignId,
					ingestionId: draft.ingestionId,
					selectedProposalIds: [session.proposalId, proposal.proposalId]
				})
			)
		)
		expect(missingResolution).toMatchObject({ cause: { reason: 'unresolvedMatch' } })

		const resolutions: SessionProposalResolution[] = [
			{ proposalId: proposal.proposalId, kind: 'existing', documentId: 'mara' }
		]
		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: [session.proposalId, proposal.proposalId],
				resolutions
			})
		)
		expect(harness.updateDocument).toHaveBeenCalledWith(
			'campaign',
			'mara',
			expect.objectContaining({ expectedRevisionId: 'revision-mara' })
		)
	})

	it('allocates unique paths when selected documents have duplicate generated names', async () => {
		const duplicateEvent = (content: string): ExtractedSessionClaim =>
			claim(content, {
				kind: 'development',
				eventTitle: 'Ceiling trap disabled',
				content,
				entityReferences: []
			})
		const harness = setup(
			[
				duplicateEvent('The party disabled the ceiling trap in the west hall.'),
				duplicateEvent('The party disabled another ceiling trap in the east hall.')
			],
			[]
		)
		const draft = await runPromise(
			analyze(
				harness.operations,
				'The party disabled the ceiling trap in the west hall.\nThe party disabled another ceiling trap in the east hall.'
			)
		)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)

		const eventPaths = harness.createDocument.mock.calls
			.map(([, input]) => input)
			.filter(({ type }) => type === 'event')
			.map(({ path }) => path)
		expect(eventPaths).toEqual([
			'Events/ceiling-trap-disabled.md',
			'Events/ceiling-trap-disabled-2.md'
		])
	})

	it('avoids paths already used by existing documents', async () => {
		const existingEvent = document('old-event', 'Old event', [], 'event', {
			path: 'Events/ceiling-trap-disabled.md'
		})
		const harness = setup(
			[
				claim('The party disabled the ceiling trap.', {
					kind: 'development',
					eventTitle: 'Ceiling trap disabled',
					content: 'The party disabled the ceiling trap.',
					entityReferences: []
				})
			],
			[existingEvent]
		)
		const draft = await runPromise(
			analyze(harness.operations, 'The party disabled the ceiling trap.')
		)

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)

		const eventCreate = harness.createDocument.mock.calls.find(
			([, input]) => input.type === 'event'
		)?.[1]
		expect(eventCreate?.path).toBe('Events/ceiling-trap-disabled-2.md')
	})

	it('never allows mention-only evidence to be committed as a mutation', async () => {
		const harness = setup([
			claim('Someone mentioned Mara.', {
				kind: 'mention',
				content: 'Mara was mentioned.',
				entityReferences: [{ label: 'Mara', type: 'npc' }]
			})
		])
		const draft = await runPromise(analyze(harness.operations, 'Someone mentioned Mara.'))
		const session = draft.proposals[0]
		const mention = draft.proposals.find(({ operation }) => operation === 'mention-only')!

		const error = await runPromise(
			flip(
				harness.operations.commit({
					campaignId: draft.campaignId,
					ingestionId: draft.ingestionId,
					selectedProposalIds: [session.proposalId, mention.proposalId]
				})
			)
		)
		expect(error).toMatchObject({ cause: { reason: 'unselectableProposal' } })
	})
})
