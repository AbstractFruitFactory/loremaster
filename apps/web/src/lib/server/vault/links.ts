import type { VaultLinkIndex } from './types'

type LinkTarget = {
	id: string
	title: string
}

export const resolveVaultLinks = (
	targetNames: string[],
	documents: LinkTarget[]
): VaultLinkIndex[] => {
	const documentIdsByTitle = new Map<string, Set<string>>()

	for (const { id, title } of documents) {
		const documentIds = documentIdsByTitle.get(title) ?? new Set<string>()
		documentIds.add(id)
		documentIdsByTitle.set(title, documentIds)
	}

	return targetNames.map((targetName) => {
		const documentIds = documentIdsByTitle.get(targetName)
		const targetDocumentId = documentIds?.size === 1 ? ([...documentIds][0] ?? null) : null

		return { targetName, targetDocumentId }
	})
}
