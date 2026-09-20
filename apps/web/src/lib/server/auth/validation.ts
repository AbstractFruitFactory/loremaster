export function isValidEmail(email: string): boolean {
	return /.+@.+/.test(email)
}

export function isEmailAllowed(email: string, allowlist: string | undefined, development: boolean) {
	const allowedEmails = new Set(
		(allowlist ?? '')
			.split(',')
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean)
	)
	return development && allowedEmails.size === 0 ? true : allowedEmails.has(email)
}

export function isSignupCodeValid(
	code: string,
	configuredCode: string | undefined,
	development: boolean
) {
	return development && !configuredCode ? true : Boolean(configuredCode) && code === configuredCode
}
