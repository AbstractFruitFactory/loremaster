import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from './redirect.js'

describe('safeRedirectPath', () => {
	it('keeps local application paths', () => {
		expect(safeRedirectPath('/campaigns/123?tab=lore')).toBe('/campaigns/123?tab=lore')
	})

	it.each([null, '', 'https://example.com', '//example.com'])('falls back for %s', (value) => {
		expect(safeRedirectPath(value)).toBe('/')
	})
})
