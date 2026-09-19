import { describe, expect, it } from 'vitest'
import { httpStatus, isUncertainTransportError } from './http-error.js'

describe('campaign import HTTP error helpers', () => {
	it('extracts numeric status values', () => {
		expect(httpStatus({ status: 409 })).toBe(409)
		expect(httpStatus(new Error('nope'))).toBeUndefined()
	})

	it('treats missing and 5xx statuses as uncertain transport', () => {
		expect(isUncertainTransportError(undefined)).toBe(true)
		expect(isUncertainTransportError({ status: 503 })).toBe(true)
		expect(isUncertainTransportError({ status: 409 })).toBe(false)
	})
})
