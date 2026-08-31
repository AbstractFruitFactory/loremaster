import type { DocumentType } from '../../document'
import type { AiPrompt } from '../ai/provider'
import type { VaultDocument } from './types'

const documentTypeGuidance: Record<DocumentType, string> = {
	player: 'Focus on who this player character is, their role in the campaign, and what makes them distinctive.',
	npc: 'Focus on who this NPC is, their role, and why they matter to the campaign.',
	location: 'Focus on what this place is, its atmosphere, and why it matters in the story.',
	session: 'Focus on what happened in this session and the most important developments.',
	item: 'Focus on what this item is, its significance, and how it might appear in play.',
	lore: 'Focus on the core fact or legend and why it matters to the campaign.',
	event: 'Focus on what happened, who or what was involved, and why the event matters.'
}

export const documentSummaryPrompt = (
	document: Pick<VaultDocument, 'title' | 'type' | 'content' | 'aliases'>
): AiPrompt => ({
	system: `Summarize campaign ${document.type} entries for a tabletop Dungeon Master. ${documentTypeGuidance[document.type]} Write one or two concise sentences with no markdown.`,
	prompt: `## Document: ${document.title}
Type: ${document.type}
${document.aliases?.length ? `Aliases: ${document.aliases.join(', ')}\n` : ''}
${document.content}`
})
