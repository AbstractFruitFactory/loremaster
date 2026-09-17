export const SESSION_TRANSCRIPT_MARKER = '<!-- loremaster:raw-transcript -->'

export type SessionBody = {
	recap: string
	transcript?: string
}

export const parseSessionBody = (body: string): SessionBody => {
	const markerMatch = /^(?:<!-- loremaster:raw-transcript -->)\r?$/m.exec(body)
	if (!markerMatch) return { recap: body }

	const recap = body.slice(0, markerMatch.index).replace(/\r?\n\r?\n$/, '')
	const transcript = body
		.slice(markerMatch.index + markerMatch[0].length)
		.replace(/^\r?\n\r?\n/, '')

	return { recap, transcript }
}

export const serializeSessionBody = (recap: string, transcript?: string) =>
	transcript === undefined
		? recap
		: `${recap.replace(/\r?\n$/, '')}\n\n${SESSION_TRANSCRIPT_MARKER}\n\n${transcript.replace(/^\r?\n/, '')}`
