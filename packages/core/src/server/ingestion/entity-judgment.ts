import { map } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { SessionEntityResolutionRequest } from './types.js'

export type EntityIdentityDecision = { referenceId: string } & (
	| { kind: 'existing'; targetId: string }
	| { kind: 'none-of-these' }
	| { kind: 'insufficient-evidence'; candidateIds: string[]; reason: string }
)

/** Pipeline step using the existing AI operation; provider selection belongs to AiProvider. */
export const judgeEntityIdentity = (
	ai: Pick<AiProvider, 'resolveSessionEntities'> & { analysisModel: string },
	references: SessionEntityResolutionRequest[]
) =>
	map(
		ai.resolveSessionEntities({
			model: ai.analysisModel,
			references
		}),
		(decisions) =>
			decisions.map((decision): EntityIdentityDecision => {
				if (decision.kind === 'create')
					return { referenceId: decision.referenceId, kind: 'none-of-these' }
				if (decision.kind === 'defer') return { ...decision, kind: 'insufficient-evidence' }
				return decision
			})
	)
