import { requireUser } from '#lib/server/auth/authorization.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = () => {
	requireUser()
	return {}
}
