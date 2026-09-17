import { describe, expect, it } from 'vitest'
import { getDocumentBody, getDocumentTitle, withDocumentTitle } from './document'

describe('document content', () => {
	it('separates the title heading from the editable body', () => {
		const content = '# The Ashen Crown\n\nAn ancient crown.\n\n## History\n\nIt was lost.'

		expect(getDocumentTitle(content)).toBe('The Ashen Crown')
		expect(getDocumentBody(content)).toBe('An ancient crown.\n\n## History\n\nIt was lost.')
	})

	it('recognizes closing hashes without truncating title punctuation', () => {
		expect(getDocumentTitle('# C#')).toBe('C#')
		expect(getDocumentTitle('# Crown of Ash ###')).toBe('Crown of Ash')
	})

	it('leaves content without a title heading unchanged', () => {
		expect(getDocumentBody('An untitled note.')).toBe('An untitled note.')
	})

	it('builds titled Markdown with the body and newline style intact', () => {
		expect(withDocumentTitle('New Title', 'First line.\n\nSecond line.')).toBe(
			'# New Title\n\nFirst line.\n\nSecond line.'
		)
		expect(withDocumentTitle('New Title', 'First line.\r\nSecond line.')).toBe(
			'# New Title\r\n\r\nFirst line.\r\nSecond line.'
		)
	})

	it('builds a heading-only document when the body is empty', () => {
		expect(withDocumentTitle('New Title', '')).toBe('# New Title')
	})
})
