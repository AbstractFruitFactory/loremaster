import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyzeSessionChunk, ResolveSessionEntities } from '../ai/provider'
import type { VaultDocument } from '../vault/types'
import { sessionIngestionOperations } from './operations'
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
	excerpt: string,
	overrides: Partial<ExtractedSessionClaim> = {}
): ExtractedSessionClaim => ({
	excerpt,
	kind: 'stable-fact',
	certainty: 'explicit',
	content: excerpt,
	entityMentions: [{ mention: 'Varek', type: 'npc' }],
	...overrides
})

const validatingAnalyzer =
	(claims: ExtractedSessionClaim[]): AnalyzeSessionChunk =>
	({ prompt }) => {
		const marker = '\n\n## Candidate claims\n'
		return succeed(
			prompt.includes(marker)
				? (JSON.parse(prompt.split(marker).at(-1) ?? '[]') as ExtractedSessionClaim[])
				: claims
		)
	}

const setup = (
	claims: ExtractedSessionClaim[],
	documents: VaultDocument[] = [varek],
	resolveSessionEntities: ResolveSessionEntities = () => succeed([])
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
	const operations = sessionIngestionOperations({
		ai: {
			analysisModel: 'analysis-model',
			analyzeSessionChunk: validatingAnalyzer(claims),
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
				entityMentions: [{ mention: 'The Gatekeeper', type: 'npc' }]
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
					entityMentions: [{ mention: 'Mara', type: 'npc' }]
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
					entityMentions: [{ mention: "Mara's age", type: 'npc' }]
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
					entityMentions: [{ mention: 'Mara Vale', type: 'npc' }]
				}),
				claim('Mara Vale carries a blue lantern.', {
					content: 'Mara Vale carries a blue lantern.',
					entityMentions: [{ mention: 'Mara Vale', type: 'npc' }]
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
					entityMentions: [{ mention: "Elias' father", type: 'npc' }]
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
					entityMentions: []
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
					entityMentions: [{ mention: 'Mara', type: 'npc' }]
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
			title: 'Mara hired the party to recover the lockbox',
			selected: true
		})
	})

	it('lets a reviewer resolve an ambiguous mention to an existing entity', async () => {
		const mara = document('mara', 'Mara Vale')
		const edric = document('edric', 'Brother Edric Vale')
		const harness = setup(
			[
				claim('Vale carried the letter.', {
					entityMentions: [{ mention: 'Vale', type: 'npc' }]
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

	it('never allows mention-only evidence to be committed as a mutation', async () => {
		const harness = setup([
			claim('Someone mentioned Mara.', {
				kind: 'mention',
				content: 'Mara was mentioned.',
				entityMentions: [{ mention: 'Mara', type: 'npc' }]
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
