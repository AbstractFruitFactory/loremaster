import { flatMap, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { Character } from '../campaign/types'
import { fail, failure } from '../failure'
import { db } from '.'
import { characters } from './schema'

export const create = (input: Omit<Character, 'id'>) =>
	pipe(
		tryPromise({
			try: () => db.insert(characters).values(input).returning(),
			catch: (cause) => failure('database', 'createCharacter', cause)
		}),
		flatMap(([character]) =>
			character
				? succeed(character)
				: fail('database', 'createCharacter', Error('Character could not be created'))
		)
	)
