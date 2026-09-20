import type { LayoutServerLoad } from './$types'
import { isAdminEmail } from '#lib/server/auth/admin.js'

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user,
	isAdmin: locals.user ? isAdminEmail(locals.user.email) : false
})
