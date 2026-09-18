export const documentTypes = [
	'player',
	'npc',
	'location',
	'session',
	'item',
	'worldbuilding',
	'event'
] as const

export type DocumentType = (typeof documentTypes)[number]

export type ProposalDocumentType = Exclude<DocumentType, 'session'>

export const loreDocumentTypes = documentTypes.filter(
	(type): type is ProposalDocumentType => type !== 'session'
)

const titleHeadingPattern = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m

export const getDocumentTitle = (content: string) => content.match(titleHeadingPattern)?.[1]?.trim()

export const getDocumentBody = (content: string) => {
	const heading = titleHeadingPattern.exec(content)
	if (!heading || heading.index === undefined) return content

	const before = content.slice(0, heading.index)
	const after = content.slice(heading.index + heading[0].length)

	if (before.trim()) return `${before}${after}`
	return after.replace(/^\r?\n(?:[ \t]*\r?\n)?/, '')
}

export const withDocumentTitle = (title: string, content: string) => {
	const newline = content.includes('\r\n') ? '\r\n' : '\n'
	const body = content.replace(/^\r?\n/, '')
	const heading = `# ${title.trim()}`
	return body ? `${heading}${newline}${newline}${body}` : heading
}

export const isDocumentType = (value: unknown): value is DocumentType =>
	typeof value === 'string' && documentTypes.some((type) => type === value)
