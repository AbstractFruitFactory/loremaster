import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type {
	AnalyzeSessionChunk,
	ResolveSessionEntities,
	ValidateSessionClaims
} from '../ai/provider'
import type { VaultDocument } from '../vault/types'
import { sessionIngestion } from '.'
import type {
	ExtractedSessionClaim,
	SessionIngestionDraft,
	SessionProposalResolution
} from './types'

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
	content: string
	ingestionId?: string
	transcript?: string
	revision?: typeof revision
}

type UpdateInput = {
	type: VaultDocument['type']
	aliases?: string[]
	after?: string[]
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
	path: `${type === 'npc' ? 'NPCs' : 'Lore'}/${title}.md`,
	title,
	type,
	aliases,
	after: [],
	summary: '',
	content: `# ${title}`,
	links: [],
	currentRevisionId: `revision-${id}`,
	...overrides
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

const setup = (
	claims: ExtractedSessionClaim[],
	documents: VaultDocument[] = [varek],
	resolveSessionEntities: ResolveSessionEntities = () => succeed([]),
	validateSessionClaims: ValidateSessionClaims = acceptingValidator
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
	const operations = sessionIngestion({
		ai: {
			analysisModel: 'analysis-model',
			analyzeSessionChunk: validatingAnalyzer(claims),
			validateSessionClaims,
			repairSessionClaimEvidence: () => succeed([]),
			resolveSessionEntities
		},
		storage: {
			write,
			read: () => succeed(saved!),
			readTranscript: () => succeed(savedTranscript)
		},
		vault: {
			getDocuments: () => succeed(documents),
			createDocument,
			updateDocument
		}
	})

	return { operations, createDocument, updateDocument, getSaved: () => saved }
}

const analyze = (
	operations: ReturnType<typeof setup>['operations'],
	transcript: string,
	title = 'Session 12'
) => operations.analyze({ campaignId: 'campaign', title, transcript })

const selectedIds = (draft: SessionIngestionDraft) =>
	draft.proposals.filter(({ selected }) => selected).map(({ proposalId }) => proposalId)

describe('session ingestion operations', () => {
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
					entityReferences: [
						{ label: 'service tunnels below Cathedral Square', type: 'location' }
					]
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

	it('keeps a world fact in the session without inventing a Lore document', async () => {
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
		const draft = await runPromise(analyze(harness.operations, 'The party disabled the ceiling trap.'))

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)

		const eventCreate = harness.createDocument.mock.calls.find(([, input]) => input.type === 'event')?.[1]
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
