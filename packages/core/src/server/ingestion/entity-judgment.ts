import { map } from 'effect/Effect'
import type { AiProvider } from '../ai/provider.js'
import type { SessionEntityResolutionRequest } from './types.js'

// Initial conservative policy; calibrate on campaign imports before relaxing.
export const identityDecisionPolicy = { minimumProbability: 0.95, minimumMargin: 0.2 }

export type EntityIdentityDecision = { referenceId: string } & (
	| { kind: 'existing'; targetId: string }
	| { kind: 'none-of-these' }
	| { kind: 'insufficient-evidence'; candidateIds: string[]; reason: string }
)

/** Pipeline step using the existing AI operation; provider selection belongs to AiProvider. */
export const judgeEntityIdentity = (
	ai: Pick<AiProvider, 'resolveSessionEntities'> & {
		analysisModel: string
		entityResolutionModel?: string
	},
	references: SessionEntityResolutionRequest[]
) =>
	map(
		ai.resolveSessionEntities({
			model: ai.entityResolutionModel ?? ai.analysisModel,
			references
		}),
		(decisions) =>
			decisions.map((decision): EntityIdentityDecision => {
				if (decision.judgment) {
					const { probabilities, choice } = decision.judgment
					const selected = probabilities[choice] ?? 0
					const runnerUp = Math.max(
						0,
						...Object.entries(probabilities)
							.filter(([option]) => option !== choice)
							.map(([, value]) => value)
					)
					if (
						selected < identityDecisionPolicy.minimumProbability ||
						selected - runnerUp < identityDecisionPolicy.minimumMargin
					) {
						return {
							referenceId: decision.referenceId,
							kind: 'insufficient-evidence',
							candidateIds: [],
							reason: 'Identity probabilities do not meet the decision threshold.'
						}
					}
				}
				if (decision.kind === 'create')
					return { referenceId: decision.referenceId, kind: 'none-of-these' }
				if (decision.kind === 'defer') return { ...decision, kind: 'insufficient-evidence' }
				return decision
			})
	)
