import { redirect } from '@sveltejs/kit'
import { deleteSessionTokenCookie, invalidateSession } from '#lib/server/auth/session.js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async (event) => {
	if (event.locals.session !== null) {
		await invalidateSession(event.locals.session.id)
	}
	deleteSessionTokenCookie(event)
	redirect(302, '/login')
}
