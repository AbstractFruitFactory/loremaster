import { hash } from '@node-rs/argon2'
import { dev } from '$app/env'
import { AUTH_ALLOWED_EMAILS, AUTH_SIGNUP_CODE } from '$app/env/private'
import { fail, redirect } from '@sveltejs/kit'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { isAdminEmail } from '#lib/server/auth/admin.js'
import { findActiveSignupInvite } from '#lib/server/auth/invitations.js'
import {
	createSession,
	generateSessionToken,
	setSessionTokenCookie
} from '#lib/server/auth/session.js'
import { safeRedirectPath } from '#lib/server/auth/redirect.js'
import { isEmailAllowed, isSignupCodeValid, isValidEmail } from '#lib/server/auth/validation.js'
import { db } from '#lib/server/db/index.js'
import { campaigns, signupInvites, users } from '#lib/server/db/schema.js'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user !== null) redirect(302, safeRedirectPath(url.searchParams.get('redirectTo')))
	const inviteToken = url.searchParams.get('invite')
	const invite = inviteToken ? await findActiveSignupInvite(inviteToken) : undefined
	return {
		inviteToken: invite ? inviteToken : '',
		inviteEmail: invite?.email ?? ''
	}
}

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData()
		const email = formData.get('email')
		const password = formData.get('password')
		const signupCode = formData.get('signupCode')
		const inviteToken = formData.get('inviteToken')
		const redirectTo = safeRedirectPath(event.url.searchParams.get('redirectTo'))

		if (!email || typeof email !== 'string') {
			return fail(400, { message: 'Invalid email', email: typeof email === 'string' ? email : '' })
		}
		if (!password || typeof password !== 'string' || password.length < 6 || password.length > 255) {
			return fail(400, {
				message: 'Password must be between 6 and 255 characters',
				email
			})
		}

		const normalizedEmail = email.trim().toLowerCase()
		if (!isValidEmail(normalizedEmail)) {
			return fail(400, { message: 'Invalid email', email })
		}
		const invite =
			typeof inviteToken === 'string' && inviteToken
				? await findActiveSignupInvite(inviteToken)
				: undefined
		const hasMatchingInvite = invite?.email === normalizedEmail
		const hasLegacyInvite =
			isEmailAllowed(normalizedEmail, AUTH_ALLOWED_EMAILS, dev) &&
			typeof signupCode === 'string' &&
			isSignupCodeValid(signupCode, AUTH_SIGNUP_CODE, dev)

		if (!isAdminEmail(normalizedEmail) && !hasMatchingInvite && !hasLegacyInvite) {
			return fail(403, { message: 'This email has not been invited', email })
		}
		const passwordHash = await hash(password, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		})

		let user: { id: string }
		try {
			user = await db.transaction(async (tx) => {
				const [created] = await tx
					.insert(users)
					.values({ email: normalizedEmail, passwordHash })
					.returning({ id: users.id })
				if (!created) throw new Error('User could not be created')

				if (invite) {
					const [accepted] = await tx
						.update(signupInvites)
						.set({ acceptedAt: new Date() })
						.where(
							and(
								eq(signupInvites.id, invite.id),
								eq(signupInvites.email, normalizedEmail),
								isNull(signupInvites.acceptedAt),
								gt(signupInvites.expiresAt, new Date())
							)
						)
						.returning({ id: signupInvites.id })
					if (!accepted) throw new Error('Invitation is no longer available')
				}

				await tx.update(campaigns).set({ ownerId: created.id }).where(isNull(campaigns.ownerId))
				return created
			})
		} catch (cause) {
			if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
				return fail(400, { message: 'Email already used', email })
			}
			throw cause
		}

		const token = generateSessionToken()
		const session = await createSession(token, user.id)
		setSessionTokenCookie(event, token, session.expiresAt)
		redirect(302, redirectTo)
	}
}
