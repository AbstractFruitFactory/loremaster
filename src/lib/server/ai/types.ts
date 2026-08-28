import type { Effect } from 'effect/Effect'

export type GenerateText<Failure = never> = (input: {
	system?: string
	prompt: string
}) => Effect<string, Failure>
