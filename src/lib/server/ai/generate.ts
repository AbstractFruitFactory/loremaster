import { succeed } from 'effect/Effect'
import type { Effect } from 'effect/Effect'
import type { Failure } from '../failure'

export type GenerateTextInput = {
	system?: string
	prompt: string
}

export type GenerateText = (
	input: GenerateTextInput
) => Effect<string, Failure<'ai', 'generateText'>>

export const generateText: GenerateText = ({ prompt }) => succeed('Lorem ipsum.')
