import { succeed, type Effect } from 'effect/Effect'
import type { Failure } from '../failure'

export const EMBEDDING_DIMENSIONS = 64
export const EMBEDDING_MODEL = 'mock-token-hash-v1'

export type EmbedTexts = (input: {
	values: string[]
}) => Effect<number[][], Failure<'ai', 'embedTexts'>>

const tokens = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

const tokenHash = (token: string) => {
	let hash = 2_166_136_261

	for (const character of token) {
		hash ^= character.codePointAt(0) ?? 0
		hash = Math.imul(hash, 16_777_619)
	}

	return hash >>> 0
}

const embedText = (text: string) => {
	const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0)

	for (const token of tokens(text)) {
		const hash = tokenHash(token)
		const index = hash % EMBEDDING_DIMENSIONS
		const direction = (hash >>> 6) & 1 ? 1 : -1
		vector[index] = (vector[index] ?? 0) + direction
	}

	const magnitude = Math.hypot(...vector)

	return magnitude ? vector.map((value) => value / magnitude) : vector
}

export const embedTexts: EmbedTexts = ({ values }) => succeed(values.map(embedText))
