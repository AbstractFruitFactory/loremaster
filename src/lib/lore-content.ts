export type LoreContentBlock =
	| { type: 'heading'; level: 2 | 3; text: string }
	| { type: 'paragraph'; text: string }
	| { type: 'list'; items: string[] }

const wikiLinkPattern = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g

export const stripDocumentTitle = (content: string) =>
	content
		.replace(/^#\s+.*(?:\r?\n|$)/, '')
		.replace(/^\r?\n/, '')
		.trim()

export const formatWikiLinks = (text: string) =>
	text.replace(wikiLinkPattern, (_match, target, label) => label ?? target)

export const parseLoreBlocks = (content: string): LoreContentBlock[] => {
	const body = stripDocumentTitle(content)
	if (!body) return []

	const blocks: LoreContentBlock[] = []
	let paragraphLines: string[] = []
	let listItems: string[] = []

	const flushParagraph = () => {
		if (!paragraphLines.length) return

		blocks.push({ type: 'paragraph', text: formatWikiLinks(paragraphLines.join('\n')) })
		paragraphLines = []
	}

	const flushList = () => {
		if (!listItems.length) return

		blocks.push({ type: 'list', items: listItems.map(formatWikiLinks) })
		listItems = []
	}

	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim()

		if (!trimmed) {
			flushParagraph()
			flushList()
			continue
		}

		const headingLevelTwo = trimmed.match(/^##\s+(.+?)\s*#*\s*$/)
		if (headingLevelTwo) {
			flushParagraph()
			flushList()
			blocks.push({ type: 'heading', level: 2, text: formatWikiLinks(headingLevelTwo[1]) })
			continue
		}

		const headingLevelThree = trimmed.match(/^###\s+(.+?)\s*#*\s*$/)
		if (headingLevelThree) {
			flushParagraph()
			flushList()
			blocks.push({ type: 'heading', level: 3, text: formatWikiLinks(headingLevelThree[1]) })
			continue
		}

		const listItem = trimmed.match(/^[-*]\s+(.+)$/)
		if (listItem) {
			flushParagraph()
			listItems.push(listItem[1])
			continue
		}

		flushList()
		paragraphLines.push(trimmed)
	}

	flushParagraph()
	flushList()

	return blocks
}
