import { AUTH_ADMIN_EMAIL } from '$app/env/private'
import { error } from '@sveltejs/kit'
import type { User } from './session.js'

export function isAdminEmail(email: string): boolean {
	return Boolean(AUTH_ADMIN_EMAIL) && email.trim().toLowerCase() === AUTH_ADMIN_EMAIL.trim().toLowerCase()
}

export function requireAdmin(user: User): User {
	if (!isAdminEmail(user.email)) error(403, 'Administrator access required')
	return user
}
