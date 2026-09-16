import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type {
	AnalyzeSessionChunk,
	RepairSessionClaimEvidence,
	ValidateSessionClaims
} from '../ai/provider'
import type { VaultDocument } from '../vault/types'
import { sessionIngestion } from '.'
import type { ExtractedSessionClaim, SessionIngestionDraft } from './types'

const extractedClaim: ExtractedSessionClaim = {
	kind: 'stable-fact',
	eventTitle: null,
	certainty: 'explicit',
	content: 'Mara opened the gate.',
	evidence: [{ startLine: 1, endLine: 1 }],
	entityReferences: [{ label: 'Mara', type: 'npc' }]
}

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

const operationsWith = (
	analyzeSessionChunk: AnalyzeSessionChunk,
	validateSessionClaims: ValidateSessionClaims = acceptingValidator,
	documents: VaultDocument[] = [],
	repairSessionClaimEvidence: RepairSessionClaimEvidence = () => succeed([])
): ReturnType<typeof sessionIngestion> =>
	sessionIngestion({
		ai: {
			analysisModel: 'analysis-model',
			analyzeSessionChunk,
			validateSessionClaims,
			repairSessionClaimEvidence,
			resolveSessionEntities: () => succeed([]),
			inferSessionChronology: () => succeed([])
		},
		storage: {
			write: () => succeed(undefined),
			read: () => succeed({} as SessionIngestionDraft),
			readTranscript: () => succeed('')
		},
		vault: {
			getDocuments: () => succeed(documents),
			createDocument: () => succeed({} as VaultDocument),
			updateDocument: () => succeed({} as VaultDocument)
		}
	})

const analyze = (operations: ReturnType<typeof sessionIngestion>, transcript: string) =>
	runPromise(operations.analyze({ campaignId: 'campaign', title: 'Session 1', transcript }))

describe('session claim validation', () => {
	it('discards an evidence-backed claim when the validator rejects its candidate id', async () => {
		const analyzeSessionChunk = vi.fn(() => succeed([extractedClaim]))
		const validateSessionClaims: ValidateSessionClaims = vi.fn(({ prompt }) => {
			const [{ candidateId }] = JSON.parse(
				prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]'
			) as { candidateId: string }[]
			return succeed([
				{ candidateId, accepted: false, certainty: 'explicit' as const, referenceValidations: [] }
			])
		})
		const operations = operationsWith(analyzeSessionChunk, validateSessionClaims)

		const draft = await analyze(operations, 'Mara opened the gate.')

		expect(analyzeSessionChunk).toHaveBeenCalledTimes(1)
		expect(validateSessionClaims).toHaveBeenCalledTimes(1)
		expect(draft.proposals).toHaveLength(1)
		expect(draft.warnings[0]).toContain('[validator-rejected]')
		expect(draft.warnings[0]).toContain('Mara opened the gate.')
	})

	it('repairs insufficient evidence once and revalidates the unchanged claim', async () => {
		const claim: ExtractedSessionClaim = {
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content: 'Ilyra Vey says the black key opens the Lower Gate.',
			evidence: [{ startLine: 2, endLine: 2 }],
			entityReferences: [
				{ label: 'Ilyra Vey', type: 'npc' },
				{ label: 'black key', type: 'item' },
				{ label: 'Lower Gate', type: 'location' }
			]
		}
		let validationCall = 0
		const validator: ValidateSessionClaims = vi.fn(({ prompt }) => {
			validationCall += 1
			const [{ candidateId, certainty, entityReferences }] = JSON.parse(
				prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]'
			) as {
				candidateId: string
				certainty: 'explicit' | 'inferred'
				entityReferences: { referenceId: string }[]
			}[]
			return succeed([
				validationCall === 1
					? {
							candidateId,
							accepted: false,
							certainty,
							reason: 'insufficient-evidence' as const,
							referenceValidations: []
						}
					: {
							candidateId,
							accepted: true,
							certainty,
							reason: 'supported' as const,
							referenceValidations: entityReferences.map(({ referenceId }) => ({
								referenceId,
								accepted: true
							}))
						}
			])
		})
		const repair: RepairSessionClaimEvidence = vi.fn(({ prompt }) => {
			const [{ candidateId }] = JSON.parse(
				prompt.split('\n\n## Claims needing evidence repair\n').at(-1) ?? '[]'
			) as { candidateId: string }[]
			return succeed([{ candidateId, evidence: [{ startLine: 1, endLine: 2 }] }])
		})
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const draft = await analyze(
			operationsWith(() => succeed([claim]), validator, [], repair),
			'Theo: I show Ilyra the black key.\nDM: She says it opens the Lower Gate.'
		)

		expect(validator).toHaveBeenCalledTimes(2)
		expect(repair).toHaveBeenCalledTimes(1)
		expect(draft.warnings).toEqual([])
		expect(draft.proposals[1]?.content).toBe(claim.content)
		expect(
			draft.proposals[1]?.evidence.map(({ startLine, endLine }) => [startLine, endLine])
		).toEqual([[1, 2]])
		expect(info).toHaveBeenCalledWith(
			'[session-ingestion] repaired claim evidence',
			expect.objectContaining({
				previousEvidenceRanges: [{ startLine: 2, endLine: 2 }],
				repairedEvidenceRanges: [{ startLine: 1, endLine: 2 }]
			})
		)
		info.mockRestore()
	})

	it('does not attempt evidence repair for a substantively unsupported claim', async () => {
		const validator: ValidateSessionClaims = ({ prompt }) => {
			const [{ candidateId }] = JSON.parse(
				prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]'
			) as { candidateId: string }[]
			return succeed([
				{
					candidateId,
					accepted: false,
					certainty: 'explicit',
					reason: 'unsupported-inference',
					referenceValidations: []
				}
			])
		}
		const repair = vi.fn<RepairSessionClaimEvidence>(() => succeed([]))
		const draft = await analyze(
			operationsWith(() => succeed([extractedClaim]), validator, [], repair),
			'Mara opened the gate.'
		)

		expect(repair).not.toHaveBeenCalled()
		expect(draft.warnings[0]).toContain('[validator-rejected]')
		expect(draft.warnings[0]).toContain('validationReason=unsupported-inference')
	})

	it('allows validation to downgrade certainty but never upgrade it', async () => {
		const analyzer: AnalyzeSessionChunk = () => succeed([extractedClaim])
		const downgrading: ValidateSessionClaims = ({ prompt }) => {
			const [{ candidateId, entityReferences }] = JSON.parse(
				prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]'
			) as { candidateId: string; entityReferences: { referenceId: string }[] }[]
			return succeed([
				{
					candidateId,
					accepted: true,
					certainty: 'inferred',
					referenceValidations: entityReferences.map(({ referenceId }) => ({
						referenceId,
						accepted: true
					}))
				}
			])
		}
		const draft = await analyze(operationsWith(analyzer, downgrading), 'Mara opened the gate.')
		expect(draft.proposals[1]).toMatchObject({ certainty: 'inferred', selected: false })

		const inferred = { ...extractedClaim, certainty: 'inferred' as const }
		const upgrading: ValidateSessionClaims = ({ prompt }) => {
			const [{ candidateId, entityReferences }] = JSON.parse(
				prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]'
			) as { candidateId: string; entityReferences: { referenceId: string }[] }[]
			return succeed([
				{
					candidateId,
					accepted: true,
					certainty: 'explicit',
					referenceValidations: entityReferences.map(({ referenceId }) => ({
						referenceId,
						accepted: true
					}))
				}
			])
		}
		const upgradedDraft = await analyze(
			operationsWith(() => succeed([inferred]), upgrading),
			'Mara opened the gate.'
		)
		expect(upgradedDraft.proposals[1]).toMatchObject({ certainty: 'inferred', selected: false })
	})

	it('keeps semantic entity references even when their labels are not literal source text', async () => {
		const ilyra: VaultDocument = {
			id: 'ilyra',
			path: 'NPCs/Ilyra Vey.md',
			title: 'Ilyra Vey',
			type: 'npc',
			aliases: ['Ilyra'],
			after: [],
			during: [],
			summary: '',
			content: '# Ilyra Vey',
			links: [],
			currentRevisionId: 'revision-ilyra'
		}
		const claim: ExtractedSessionClaim = {
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content: 'Ilyra says the black key opens the Lower Gate.',
			evidence: [{ startLine: 1, endLine: 2 }],
			entityReferences: [{ label: 'Ilyra Vey', type: 'npc' }]
		}
		const draft = await analyze(
			operationsWith(() => succeed([claim]), acceptingValidator, [ilyra]),
			'Theo: I show Ilyra the black key.\nDM: She says it opens the Lower Gate.'
		)

		expect(draft.warnings).toEqual([])
		expect(draft.proposals[1]).toMatchObject({
			operation: 'update-canon',
			title: 'Ilyra Vey',
			match: { kind: 'exact', documentId: 'ilyra' }
		})
	})

	it('keeps a supported claim while discarding an unsupported semantic entity reference', async () => {
		const claim: ExtractedSessionClaim = {
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content: 'The ledger says E. Vey retained the bell mechanism.',
			evidence: [{ startLine: 1, endLine: 1 }],
			entityReferences: [
				{ label: 'Elias Vey', type: 'npc' },
				{ label: 'bell mechanism', type: 'item' }
			]
		}
		const validator: ValidateSessionClaims = ({ prompt }) => {
			const [{ candidateId, entityReferences }] = JSON.parse(
				prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]'
			) as {
				candidateId: string
				entityReferences: { referenceId: string; label: string }[]
			}[]
			return succeed([
				{
					candidateId,
					accepted: true,
					certainty: 'explicit',
					referenceValidations: entityReferences.map(({ referenceId, label }) => ({
						referenceId,
						accepted: label === 'bell mechanism'
					}))
				}
			])
		}
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const draft = await analyze(
			operationsWith(() => succeed([claim]), validator),
			'Ledger: E. Vey retained the bell mechanism.'
		)

		expect(draft.proposals).toHaveLength(2)
		expect(draft.proposals[1]).toMatchObject({
			content: 'The ledger says E. Vey retained the bell mechanism.',
			references: [{ label: 'bell mechanism' }]
		})
		expect(draft.warnings[0]).toContain('[validator-rejected-reference]')
		expect(draft.warnings[0]).toContain('Elias Vey')
		expect(warn).toHaveBeenCalledWith(
			'[session-ingestion] discarded entity reference',
			expect.objectContaining({
				reason: 'validator-rejected-reference',
				entityReference: { label: 'Elias Vey', type: 'npc' }
			})
		)
		warn.mockRestore()
	})

	it('materializes multiple evidence spans and logs discarded claims with source details', async () => {
		const multiSpan = {
			...extractedClaim,
			content: 'Seraphine was Elias daughter and died twenty-nine years ago.',
			evidence: [
				{ startLine: 1, endLine: 2 },
				{ startLine: 4, endLine: 4 }
			],
			entityReferences: [{ label: 'Seraphine Vey', type: 'npc' as const }]
		}
		const draft = await analyze(
			operationsWith(() => succeed([multiSpan])),
			'GM: Seraphine Vey.\nPlayer: Elias daughter?\nGM: Yes.\nGM: She died twenty-nine years ago.'
		)
		expect(draft.proposals[1]?.evidence.map(({ excerpt }) => excerpt)).toEqual([
			'GM: Seraphine Vey.\nPlayer: Elias daughter?',
			'GM: She died twenty-nine years ago.'
		])

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const invalid = { ...extractedClaim, evidence: [{ startLine: 99, endLine: 99 }] }
		const invalidDraft = await analyze(
			operationsWith(() => succeed([invalid])),
			'Mara opened the gate.'
		)
		expect(invalidDraft.warnings[0]).toContain('[evidence-outside-chunk]')
		expect(warn).toHaveBeenCalledWith(
			'[session-ingestion] discarded claim',
			expect.objectContaining({
				reason: 'evidence-outside-chunk',
				content: 'Mara opened the gate.',
				evidenceRanges: [{ startLine: 99, endLine: 99 }]
			})
		)
		warn.mockRestore()
	})

	it('treats persistent entity identity as part of reference validation', async () => {
		const claim: ExtractedSessionClaim = {
			kind: 'stable-fact',
			eventTitle: null,
			certainty: 'explicit',
			content: 'The wall gives a hollow note when Brakka taps it.',
			evidence: [{ startLine: 1, endLine: 1 }],
			entityReferences: [{ label: 'Wall', type: 'location' }]
		}
		const analyzer: AnalyzeSessionChunk = vi.fn(({ system }) => {
			expect(system ?? '').toContain('Only emit entity references for durable campaign entities')
			expect(system ?? '').toContain(
				'A location reference must denote a distinct, persistent place'
			)
			expect(system ?? '').toContain('Scene or section headings are editorial structure')
			expect(system ?? '').toContain('display-ready canonical names')
			expect(system ?? '').toContain('Service Tunnels Below Cathedral Square')
			return succeed([claim])
		})
		const validator: ValidateSessionClaims = vi.fn(({ system, prompt }) => {
			expect(system ?? '').toContain('Reference validation checks entityhood and type')
			expect(system ?? '').toContain('A Location must be a distinct, persistent place')
			expect(system ?? '').toContain('Scene or section headings are editorial context')
			const [{ candidateId, certainty, entityReferences }] = JSON.parse(
				prompt.split('\n\n## Candidate claims\n').at(-1) ?? '[]'
			) as {
				candidateId: string
				certainty: 'explicit' | 'inferred'
				entityReferences: { referenceId: string }[]
			}[]
			return succeed([
				{
					candidateId,
					accepted: true,
					certainty,
					reason: 'supported' as const,
					referenceValidations: entityReferences.map(({ referenceId }) => ({
						referenceId,
						accepted: false
					}))
				}
			])
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const draft = await analyze(
			operationsWith(analyzer, validator),
			'DM: The wall gives a hollow note when Brakka taps it.'
		)

		expect(draft.proposals.some((proposal) => proposal.documentType === 'location')).toBe(false)
		expect(draft.proposals[1]).toMatchObject({
			operation: 'record-only',
			content: claim.content
		})
		expect(draft.warnings[0]).toContain('[validator-rejected-reference]')
		expect(draft.warnings[0]).toContain('Wall')
		warn.mockRestore()
	})
})
