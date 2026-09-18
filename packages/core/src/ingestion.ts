type RecapProposal = {
	documentType: string
	operation: string
	content: string
}

const normalize = (value: string) => value.trim().toLocaleLowerCase()

const uniqueContent = (contents: string[]) => [
	...new Map(
		contents
			.map((content) => content.trim())
			.filter(Boolean)
			.map((content) => [normalize(content), content])
	).values()
]

export const canonicalDocumentContent = (title: string, content: string) => {
	const body = content
		.trim()
		.replace(/^#\s+[^\r\n]*(?:\r?\n+|$)/, '')
		.trim()
	return `# ${title}${body ? `\n\n${body}` : ''}`
}

export const buildSessionRecap = (title: string, proposals: RecapProposal[]) =>
	canonicalDocumentContent(
		title,
		uniqueContent(
			proposals
				.filter(
					(proposal) => proposal.documentType !== 'session' && proposal.operation !== 'mention-only'
				)
				.map(({ content }) => content)
		).join('\n\n')
	)
