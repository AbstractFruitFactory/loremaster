import { describe, expect, it, vi } from 'vitest'
import { failure, logFailure } from './failure'

describe('failure logging', () => {
	it('logs the operation and underlying cause', () => {
		const cause = Error('Database unavailable')
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		logFailure(failure('database', 'listCampaigns', cause))

		expect(consoleError).toHaveBeenCalledWith('[database.listCampaigns]', cause)
		consoleError.mockRestore()
	})
})
