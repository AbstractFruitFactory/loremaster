import { getRequestEvent } from '$app/server'
import { error, redirect } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'
import { db } from '#lib/server/db/index.js'
import { campaigns } from '#lib/server/db/schema.js'
import type { User } from './session.js'

export function requireUser(): User {
	const { locals } = getRequestEvent()
	if (locals.user === null) {
		// Remote queries may read `locals`, but SvelteKit intentionally prevents
		// them from reading `event.url`. Only access it on the unauthenticated
		// request path, where we need to preserve the destination for the login
		// redirect.
		const { url } = getRequestEvent()
		const redirectTo = url.pathname + url.search
		const params = new URLSearchParams({ redirectTo })
		redirect(303, `/login?${params}`)
	}
	return locals.user
}

export async function requireCampaignOwner(campaignId: string): Promise<User> {
	const user = requireUser()
	const [campaign] = await db
		.select({ id: campaigns.id })
		.from(campaigns)
		.where(and(eq(campaigns.id, campaignId), eq(campaigns.ownerId, user.id)))
		.limit(1)

	if (!campaign) error(404, 'Campaign not found')
	return user
}
