import { flip, runPromise } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../../vault/types.js'
import type { SessionChronologyProposal } from '../types.js'
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
