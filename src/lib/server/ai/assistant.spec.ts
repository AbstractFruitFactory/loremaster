import { runSync } from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { generateAssistant } from './assistant'

describe('mock assistant generation', () => {
	it('answers questions without proposing lore', () => {
		const response = runSync(
			generateAssistant({
				prompt: '## Current message\nWhat does Varek know?'
			})
		)

		expect(response.proposal).toBeUndefined()
	})

	it('routes canon-changing requests to a structured proposal', () => {
		const response = runSync(
			generateAssistant({
				prompt: '## Current message\nCreate a blacksmith who protects the town.'
			})
		)

		expect(response.proposal).toMatchObject({
			title: 'New npc',
			category: 'npc'
		})
	})
})
