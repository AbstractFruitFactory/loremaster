import { describe, expect, it } from 'vitest'
import { runSync } from 'effect/Effect'
import { parseVaultDocument, serializeVaultDocument } from './markdown'
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

	it('excludes a Session transcript from the summary prompt', () => {
		const source = serializeVaultDocument(
			{ id: 'session-12', type: 'session', ingestionId: 'ingestion-12' },
			'# Session 12\n\nThe party entered Westgate.',
			'PRIVATE TRANSCRIPT DETAIL'
		)
		const document = runSync(parseVaultDocument('Sessions/Session 12.md', source))
		const prompt = documentSummaryPrompt({
			title: document.title,
			type: document.type!,
			aliases: document.aliases,
			content: document.content
		})

		expect(prompt.prompt).toContain('The party entered Westgate.')
		expect(prompt.prompt).not.toContain('PRIVATE TRANSCRIPT DETAIL')
	})
})
