import { map } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { ResolutionCandidate } from './internal.js'
import type { IngestionDocumentType } from './types.js'

/** Structured input shared by identity providers; retrieval and mutation stay in the pipeline. */
export type EntityIdentityRequest = {
	referenceId: string
	reference: string
	type: IngestionDocumentType
	evidence: string
	candidates: Pick<ResolutionCandidate, 'targetId' | 'title' | 'type' | 'context' | 'provenance'>[]
}

export type EntityIdentityDecision = { referenceId: string } & (
	| { kind: 'existing'; targetId: string }
	| { kind: 'none-of-these' }
	| { kind: 'insufficient-evidence'; candidateIds: string[]; reason: string }
)

/** Pipeline step using the existing AI operation; provider selection belongs to AiProvider. */
export const judgeEntityIdentity = (
	ai: Pick<AiProvider, 'resolveSessionEntities'> & { analysisModel: string },
	requests: EntityIdentityRequest[]
) =>
	map(
		ai.resolveSessionEntities({
			model: ai.analysisModel,
			system:
				'Resolve entity identity conservatively and return exactly one explicit outcome per reference. Use existing only when the supplied evidence and candidate context establish that the reference is the same campaign entity as that supplied target; the target may be a persisted campaign document or another entity being created from this session. A relational-context or session-entity candidate may establish identity for a phrase such as "Elias\' father", but neither is a reason to defer to the user. Use create when the evidence describes a new named entity or event and none of the supplied identity candidates is the same thing. Use defer when one or more supplied exact-name, alias, or partial-name candidates remain genuinely plausible identities and the evidence cannot establish whether to use one of them or create a new entry; include only their supplied IDs and explain the ambiguity. Never defer relational-context or session-entity candidates, invent a target, or return an ID that was not supplied.',
			prompt: JSON.stringify({ references: requests }, null, 2)
		}),
		(decisions) =>
			decisions.map((decision): EntityIdentityDecision => {
				if (decision.kind === 'create')
					return { referenceId: decision.referenceId, kind: 'none-of-these' }
				if (decision.kind === 'defer') return { ...decision, kind: 'insufficient-evidence' }
				return decision
			})
	)
