import type { Session, User } from '#lib/server/auth/session.js'

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: User | null
			session: Session | null
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {}
