import { fail, redirect } from '@sveltejs/kit'
import { verify } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import {
	createSession,
	generateSessionToken,
	setSessionTokenCookie
} from '#lib/server/auth/session.js'
import { safeRedirectPath } from '#lib/server/auth/redirect.js'
import { db } from '#lib/server/db/index.js'
import { users } from '#lib/server/db/schema.js'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user !== null) redirect(302, safeRedirectPath(url.searchParams.get('redirectTo')))
	return {}
}

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData()
		const email = formData.get('email')
		const password = formData.get('password')
		const redirectTo = safeRedirectPath(event.url.searchParams.get('redirectTo'))

		if (!email || typeof email !== 'string') {
			return fail(400, { message: 'Invalid email', email: '' })
		}
		if (!password || typeof password !== 'string' || password.length > 255) {
			return fail(400, { message: 'Invalid password', email })
		}

		const normalizedEmail = email.trim().toLowerCase()
		const [user] = await db
			.select({ id: users.id, passwordHash: users.passwordHash })
			.from(users)
			.where(eq(users.email, normalizedEmail))
			.limit(1)

		if (!user) {
			return fail(400, { message: 'Invalid email or password', email })
		}

		const validPassword = await verify(user.passwordHash, password, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		})
		if (!validPassword) {
			return fail(400, { message: 'Invalid email or password', email })
		}

		const token = generateSessionToken()
		const session = await createSession(token, user.id)
		setSessionTokenCookie(event, token, session.expiresAt)
		redirect(302, redirectTo)
	}
}
