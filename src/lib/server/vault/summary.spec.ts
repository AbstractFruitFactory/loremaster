import { describe, expect, it } from 'vitest'
import { documentSummaryPrompt } from './summary'

describe('documentSummaryPrompt', () => {
	it('includes document metadata and type-specific guidance', () => {
		const prompt = documentSummaryPrompt({
			title: 'Varek',
			type: 'npc',
			aliases: ['Varek the Smith'],
			content: '# Varek\n\nRuns the forge.'
		})

		expect(prompt.system).toContain('npc')
		expect(prompt.prompt).toContain('## Document: Varek')
		expect(prompt.prompt).toContain('Type: npc')
		expect(prompt.prompt).toContain('Aliases: Varek the Smith')
		expect(prompt.prompt).toContain('Runs the forge.')
	})
})
