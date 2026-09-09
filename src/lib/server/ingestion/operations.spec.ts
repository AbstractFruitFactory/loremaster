import { flip, runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
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
	type: VaultDocument['type'] = 'npc'
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
	currentRevisionId: `revision-${id}`
})

const varek = document('varek', 'Varek', ['The Gatekeeper'])

const claim = (
	excerpt: string,
	overrides: Partial<ExtractedSessionClaim> = {}
): ExtractedSessionClaim => ({
	excerpt,
	title: 'The Gatekeeper',
	documentType: 'npc',
	kind: 'stable-fact',
	certainty: 'explicit',
	content: excerpt,
	references: [],
	after: [],
	...overrides
})

const setup = (claims: ExtractedSessionClaim[], documents: VaultDocument[] = [varek]) => {
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
			analyzeSessionChunk: () => succeed(claims)
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
	it('keeps only evidence-backed claims and records ingestion revision metadata', async () => {
		const harness = setup([
			claim('Varek opened the gate.', {
				content: 'Varek can open the western gate.',
				references: ['Varek']
			}),
			claim('This was never said.', {
				title: 'Invented claim',
				documentType: 'lore',
				content: 'Invented content.'
			})
		])
		const transcript = 'GM: The party waits.\nVarek opened the gate.'
		const draft = await runPromise(analyze(harness.operations, transcript))

		expect(harness.getSaved()).toEqual(draft)
		expect(draft.warnings).toHaveLength(1)
		expect(draft.proposals).toHaveLength(2)
		expect(draft.proposals[1]).toMatchObject({
			operation: 'update-canon',
			selected: true,
			match: { kind: 'exact', documentId: 'varek' },
			base: { documentId: 'varek', revisionId: 'revision-varek' }
		})
		expect(draft.proposals.flatMap(({ content }) => content)).not.toContain('Invented content.')

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
				content: '# Session 12\n\nVarek can open the western gate.',
				ingestionId: draft.ingestionId,
				transcript,
				revision: {
					source: 'ingestion',
					relatedSessionId: result.sessionDocumentId,
					ingestionId: draft.ingestionId,
					changeSummary: 'Created from session ingestion: Session 12'
				}
			})
		)
		expect(harness.updateDocument).toHaveBeenCalledWith(
			'campaign',
			'varek',
			expect.objectContaining({
				content: '# Varek\n\nVarek can open the western gate.\n',
				expectedRevisionId: 'revision-varek',
				revision: expect.objectContaining({
					source: 'ingestion',
					relatedSessionId: result.sessionDocumentId,
					ingestionId: draft.ingestionId
				})
			})
		)
	})

	it('groups distinct claims for the same canonical target into one update', async () => {
		const harness = setup([
			claim('Varek opened the gate.', { content: 'Varek controls the western gate.' }),
			claim('The Gatekeeper carried a silver key.', {
				title: 'Varek',
				content: 'Varek carries a silver key.'
			})
		])
		const draft = await runPromise(
			analyze(harness.operations, 'Varek opened the gate.\nThe Gatekeeper carried a silver key.')
		)
		const proposals = draft.proposals.filter(({ documentType }) => documentType !== 'session')

		expect(proposals).toHaveLength(1)
		expect(proposals[0]).toMatchObject({
			operation: 'update-canon',
			claimIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
			evidence: [expect.any(Object), expect.any(Object)],
			patch: {
				content: 'Varek controls the western gate.\n\nVarek carries a silver key.'
			}
		})

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: selectedIds(draft)
			})
		)
		expect(harness.updateDocument).toHaveBeenCalledTimes(1)
	})

	it('builds the canonical Session recap from approved claims only', async () => {
		const rumor = document('rumor', 'Old Rumor', [], 'lore')
		const harness = setup(
			[
				claim('Varek opened the gate.', { content: 'Varek opened the western gate.' }),
				claim('Perhaps the moon caused it.', {
					title: 'Old Rumor',
					documentType: 'lore',
					certainty: 'inferred',
					content: 'The moon may control the gate.'
				}),
				claim('Someone mentioned Mara.', {
					title: 'Mara',
					kind: 'mention',
					content: 'Mara was mentioned.'
				})
			],
			[varek, rumor]
		)
		const transcript =
			'Varek opened the gate.\nPerhaps the moon caused it.\nSomeone mentioned Mara.'
		const draft = await runPromise(analyze(harness.operations, transcript))
		const session = draft.proposals.find(({ documentType }) => documentType === 'session')!
		const explicit = draft.proposals.find(({ title }) => title === 'Varek')!

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: [session.proposalId, explicit.proposalId]
			})
		)
		const sessionCreate = harness.createDocument.mock.calls.find(
			([, input]) => input.type === 'session'
		)?.[1]
		expect(sessionCreate?.content).toBe('# Session 12\n\nVarek opened the western gate.')
		expect(sessionCreate?.content).not.toContain('moon')
		expect(sessionCreate?.content).not.toContain('Mara')
	})

	it('allows a reviewer to approve an inferred proposal but never a mention', async () => {
		const rumor = document('rumor', 'Old Rumor', [], 'lore')
		const harness = setup(
			[
				claim('Perhaps the moon caused it.', {
					title: 'Old Rumor',
					documentType: 'lore',
					certainty: 'inferred',
					content: 'The moon may control the gate.'
				}),
				claim('Someone mentioned Mara.', {
					title: 'Mara',
					kind: 'mention'
				})
			],
			[rumor]
		)
		const draft = await runPromise(
			analyze(harness.operations, 'Perhaps the moon caused it.\nSomeone mentioned Mara.')
		)
		const session = draft.proposals[0]
		const inferred = draft.proposals.find(({ certainty }) => certainty === 'inferred')!
		const mention = draft.proposals.find(({ operation }) => operation === 'mention-only')!

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: [session.proposalId, inferred.proposalId]
			})
		)
		expect(harness.updateDocument).toHaveBeenCalledWith('campaign', 'rumor', expect.any(Object))

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

	it('requires an explicit possible-match resolution and can update the chosen candidate', async () => {
		const candidate = document('varek-smith', 'Varek the Smith')
		const harness = setup(
			[claim('Varek Smith forged the key.', { title: 'Varek Smith' })],
			[candidate]
		)
		const draft = await runPromise(analyze(harness.operations, 'Varek Smith forged the key.'))
		const session = draft.proposals[0]
		const proposal = draft.proposals[1]
		expect(proposal).toMatchObject({
			selected: false,
			match: {
				kind: 'unresolved',
				candidates: [{ documentId: 'varek-smith', revisionId: 'revision-varek-smith' }]
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
		expect(harness.createDocument).not.toHaveBeenCalled()

		const resolutions: SessionProposalResolution[] = [
			{ proposalId: proposal.proposalId, kind: 'existing', documentId: 'varek-smith' }
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
			'varek-smith',
			expect.objectContaining({ expectedRevisionId: 'revision-varek-smith' })
		)
	})

	it('lets the reviewer explicitly create a new document instead of using a candidate', async () => {
		const candidate = document('varek-smith', 'Varek the Smith')
		const harness = setup(
			[claim('Varek Smith forged the key.', { title: 'Varek Smith' })],
			[candidate]
		)
		const draft = await runPromise(analyze(harness.operations, 'Varek Smith forged the key.'))
		const [session, proposal] = draft.proposals

		await runPromise(
			harness.operations.commit({
				campaignId: draft.campaignId,
				ingestionId: draft.ingestionId,
				selectedProposalIds: [session.proposalId, proposal.proposalId],
				resolutions: [{ proposalId: proposal.proposalId, kind: 'create' }]
			})
		)

		expect(harness.updateDocument).not.toHaveBeenCalled()
		expect(harness.createDocument).toHaveBeenCalledWith(
			'campaign',
			expect.objectContaining({
				path: 'NPCs/varek-smith.md',
				content: '# Varek Smith\n\nVarek Smith forged the key.'
			})
		)
	})

	it('rejects two reviewer resolutions targeting the same document before writing canon', async () => {
		const candidate = document('varek', 'Varek')
		const harness = setup(
			[
				claim('Varek Smith opened the gate.', { title: 'Varek Smith' }),
				claim('Varek Stone closed the gate.', { title: 'Varek Stone' })
			],
			[candidate]
		)
		const draft = await runPromise(
			analyze(harness.operations, 'Varek Smith opened the gate.\nVarek Stone closed the gate.')
		)
		const [session, first, second] = draft.proposals

		const error = await runPromise(
			flip(
				harness.operations.commit({
					campaignId: draft.campaignId,
					ingestionId: draft.ingestionId,
					selectedProposalIds: [session.proposalId, first.proposalId, second.proposalId],
					resolutions: [first, second].map((proposal) => ({
						proposalId: proposal.proposalId,
						kind: 'existing' as const,
						documentId: candidate.id
					}))
				})
			)
		)

		expect(error).toMatchObject({ cause: { reason: 'duplicateDocumentMutation' } })
		expect(harness.createDocument).not.toHaveBeenCalled()
		expect(harness.updateDocument).not.toHaveBeenCalled()
	})

	it('groups new-entity facts and preserves the intended title in created Markdown', async () => {
		const harness = setup(
			[
				claim('Mara knows the old road.', {
					title: 'Mara Vale',
					content: 'Mara knows the old road.'
				}),
				claim('Mara carries a blue lantern.', {
					title: 'Mara Vale',
					content: 'Mara carries a blue lantern.'
				})
			],
			[]
		)
		const draft = await runPromise(
			analyze(harness.operations, 'Mara knows the old road.\nMara carries a blue lantern.')
		)
		const entity = draft.proposals.find(({ documentType }) => documentType === 'npc')!
		expect(draft.proposals).toHaveLength(2)
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
			content: '# Mara Vale\n\nMara knows the old road.\n\nMara carries a blue lantern.'
		})
	})

	it('preflights unresolved chronology before creating the mandatory Session', async () => {
		const harness = setup(
			[
				claim('The tower fell after an unknown battle.', {
					title: 'The Tower Falls',
					documentType: 'event',
					kind: 'development',
					after: ['Unknown Battle']
				})
			],
			[]
		)
		const draft = await runPromise(
			analyze(harness.operations, 'The tower fell after an unknown battle.')
		)

		const error = await runPromise(
			flip(
				harness.operations.commit({
					campaignId: draft.campaignId,
					ingestionId: draft.ingestionId,
					selectedProposalIds: selectedIds(draft)
				})
			)
		)
		expect(error).toMatchObject({ cause: { reason: 'unresolvedChronology' } })
		expect(harness.createDocument).not.toHaveBeenCalled()
	})
})
