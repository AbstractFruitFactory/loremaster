import { flip, runPromise } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../../vault/types.js'
import type { SessionChronologyProposal, SessionProposal } from '../types.js'
import { planMutations } from './planning.js'

const event = (id: string, type: VaultDocument['type'] = 'event'): VaultDocument => ({
	id,
	path: `${type}/${id}.md`,
	title: id,
	type,
	aliases: [],
	after: [],
	during: [],
	summary: '',
	content: `# ${id}`,
	links: [],
	currentRevisionId: `revision-${id}`
})

const chronology = (sourceEventId: string): SessionChronologyProposal => ({
	chronologyId: 'chronology-1',
	relation: 'before',
	source: { eventId: sourceEventId, title: sourceEventId, source: 'existing' },
	target: { eventId: 'target-event', title: 'Target', source: 'existing' },
	certainty: 'explicit',
	reason: 'Evidence establishes the order.',
	selected: true
})

describe('commit planning chronology endpoints', () => {
	it('creates a period with empty chronology when its placement is unknown', async () => {
		const proposal: SessionProposal = {
			proposalId: 'war-proposal',
			claimIds: ['war-claim'],
			operation: 'create-entity',
			documentType: 'event',
			title: 'War of the Ages',
			certainty: 'explicit',
			selected: true,
			evidence: [],
			match: { kind: 'unresolved', candidates: [] },
			references: [],
			content: 'The War of the Ages was a war.',
			eventForm: 'period',
			canCreate: true
		}
		const plan = await runPromise(planMutations('ingestion-1', [proposal], [], undefined, []))

		expect(plan.planned).toEqual([
			expect.objectContaining({
				proposal,
				after: [],
				during: [],
				eventForm: 'period'
			})
		])
		expect(plan.chronologyUpdates).toEqual([])
	})

	it.each([
		['missing', [event('target-event')]],
		['non-event', [event('source-event', 'npc'), event('target-event')]]
	])('rejects a %s selected chronology endpoint as stale', async (_, documents) => {
		const sourceEventId = documents.some(({ id }) => id === 'source-event')
			? 'source-event'
			: 'missing-event'
		const failure = await runPromise(
			flip(planMutations('ingestion-1', [], [chronology(sourceEventId)], undefined, documents))
		)

		expect(failure).toMatchObject({
			domain: 'ingestion',
			operation: 'commit',
			cause: {
				reason: 'staleChronologyEndpoint',
				chronologyId: 'chronology-1',
				endpoint: {
					role: 'source',
					eventId: sourceEventId,
					source: 'existing'
				}
			}
		})
	})
})
