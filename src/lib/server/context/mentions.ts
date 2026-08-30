export const MAX_MENTION_WORDS = 12

const words = (value: string) =>
	value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLocaleLowerCase()
		.match(/[\p{L}\p{N}]+/gu) ?? []

const normalizeName = (value: string) => words(value).join(' ')

export const documentMentionNames = (title: string, aliases: string[] = []) => [
	...new Set([title, ...aliases].map(normalizeName).filter(Boolean))
]

export const mentionCandidates = (message: string) => {
	const messageWords = words(message)
	const candidates = new Set<string>()

	for (let start = 0; start < messageWords.length; start += 1) {
		const remaining = messageWords.length - start
		const maxLength = Math.min(MAX_MENTION_WORDS, remaining)

		for (let length = 1; length <= maxLength; length += 1) {
			candidates.add(messageWords.slice(start, start + length).join(' '))
		}
	}

	return [...candidates]
}
