import { sha256 } from '@oslojs/crypto/sha2'
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '#lib/server/db/index.js'
import { signupInvites } from '#lib/server/db/schema.js'

const INVITE_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7

export function generateInviteToken(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return encodeBase32LowerCaseNoPadding(bytes)
}

export function hashInviteToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)))
}

export async function createSignupInvite(email: string, createdBy: string) {
	const token = generateInviteToken()
	const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS)
	await db.insert(signupInvites).values({
		email,
		tokenHash: hashInviteToken(token),
		createdBy,
		expiresAt
	})
	return { token, expiresAt }
}

export async function findActiveSignupInvite(token: string) {
	const [invite] = await db
		.select({ id: signupInvites.id, email: signupInvites.email, expiresAt: signupInvites.expiresAt })
		.from(signupInvites)
		.where(
			and(
				eq(signupInvites.tokenHash, hashInviteToken(token)),
				isNull(signupInvites.acceptedAt),
				gt(signupInvites.expiresAt, new Date())
			)
		)
		.limit(1)
	return invite
}
