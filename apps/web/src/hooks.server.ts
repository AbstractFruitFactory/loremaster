import { disposeCoreRuntime } from '#lib/server/app.js'
import {
	deleteSessionTokenCookie,
	setSessionTokenCookie,
	validateSessionToken
} from '#lib/server/auth/session.js'
import { disposeDbosClient } from '#lib/server/dbos/client.js'
import type { Handle } from '@sveltejs/kit/hooks'

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('session') ?? null
	if (token === null) {
		event.locals.user = null
		event.locals.session = null
		return resolve(event)
	}

	const { session, user } = await validateSessionToken(token)
	if (session !== null) {
		setSessionTokenCookie(event, token, session.expiresAt)
	} else {
		deleteSessionTokenCookie(event)
	}

	event.locals.session = session
	event.locals.user = user
	return resolve(event)
}

let registered = false

export const init = () => {
	if (registered) return
	registered = true
	process.once('sveltekit:shutdown', async () => {
		await disposeDbosClient()
		await disposeCoreRuntime()
	})
}
