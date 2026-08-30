import type { AssistantContext, ContextItem } from './types'

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 12_000

export const estimateTokens = (content: string) => Math.ceil(content.length / 4)

export const selectWithinBudget = (
	items: ContextItem[],
	maxTokens = DEFAULT_CONTEXT_TOKEN_BUDGET
): AssistantContext => {
	const selected: ContextItem[] = []
	let estimatedTokens = 0

	for (const item of items) {
		const itemTokens = estimateTokens(item.fragment.content)

		if (!selected.length || estimatedTokens + itemTokens <= maxTokens) {
			selected.push(item)
			estimatedTokens += itemTokens
		}
	}

	return { items: selected, estimatedTokens }
}
