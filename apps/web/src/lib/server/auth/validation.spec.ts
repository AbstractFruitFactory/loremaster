import { describe, expect, it } from 'vitest'
import { isEmailAllowed, isSignupCodeValid, isValidEmail } from './validation.js'

describe('isValidEmail', () => {
	it.each(['dm@example.com', 'lore.master+test@example.co.uk'])('accepts %s', (email) => {
		expect(isValidEmail(email)).toBe(true)
	})

	it.each(['', 'dm', '@example.com', 'dm@'])('rejects %s', (email) => {
		expect(isValidEmail(email)).toBe(false)
	})
})

describe('isEmailAllowed', () => {
	it('matches normalized emails from a comma-separated allowlist', () => {
		expect(isEmailAllowed('dm@example.com', ' owner@example.com, DM@example.com ', false)).toBe(
			true
		)
	})

	it('rejects unlisted emails and a missing production allowlist', () => {
		expect(isEmailAllowed('stranger@example.com', 'dm@example.com', false)).toBe(false)
		expect(isEmailAllowed('dm@example.com', undefined, false)).toBe(false)
	})

	it('allows local setup without an allowlist', () => {
		expect(isEmailAllowed('dm@example.com', undefined, true)).toBe(true)
	})
})

describe('isSignupCodeValid', () => {
	it('accepts only the configured production code', () => {
		expect(
			isSignupCodeValid('correct horse battery staple', 'correct horse battery staple', false)
		).toBe(true)
		expect(isSignupCodeValid('wrong', 'correct horse battery staple', false)).toBe(false)
		expect(isSignupCodeValid('', undefined, false)).toBe(false)
	})

	it('allows local setup without a code', () => {
		expect(isSignupCodeValid('', undefined, true)).toBe(true)
	})
})
