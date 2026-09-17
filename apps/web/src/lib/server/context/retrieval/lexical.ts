const ignoredSearchWords = new Set([
	'about',
	'does',
	'from',
	'have',
	'into',
	'that',
	'the',
	'their',
	'this',
	'what',
	'when',
	'where',
	'which',
	'with',
	'would'
])

export const extractSearchTerms = (query: string) =>
	(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
		(term) => term.length > 2 && !ignoredSearchWords.has(term)
	)
