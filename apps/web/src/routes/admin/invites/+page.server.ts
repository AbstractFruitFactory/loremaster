import { fail } from '@sveltejs/kit'
import { desc } from 'drizzle-orm'
import { requireAdmin } from '#lib/server/auth/admin.js'
import { requireUser } from '#lib/server/auth/authorization.js'
import { createSignupInvite } from '#lib/server/auth/invitations.js'
import { isValidEmail } from '#lib/server/auth/validation.js'
import { db } from '#lib/server/db/index.js'
import { signupInvites } from '#lib/server/db/schema.js'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
	requireAdmin(requireUser())
	const invites = await db
		.select({
			id: signupInvites.id,
			email: signupInvites.email,
			expiresAt: signupInvites.expiresAt,
			acceptedAt: signupInvites.acceptedAt,
			createdAt: signupInvites.createdAt
		})
		.from(signupInvites)
		.orderBy(desc(signupInvites.createdAt))
		.limit(25)
	return { invites }
}

export const actions: Actions = {
	default: async (event) => {
		const admin = requireAdmin(requireUser())
		const formData = await event.request.formData()
		const emailValue = formData.get('email')
		const email = typeof emailValue === 'string' ? emailValue.trim().toLowerCase() : ''

		if (!isValidEmail(email)) return fail(400, { message: 'Enter a valid email address', email })

		const invite = await createSignupInvite(email, admin.id)
		const inviteUrl = new URL('/signup', event.url.origin)
		inviteUrl.searchParams.set('invite', invite.token)
		return {
			message: `Invitation created for ${email}`,
			email,
			inviteUrl: inviteUrl.toString(),
			expiresAt: invite.expiresAt
		}
	}
}
