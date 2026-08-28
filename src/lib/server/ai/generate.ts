import { succeed } from 'effect/Effect'
import type { GenerateText } from './types'

export const fakeGenerateText: GenerateText = ({ prompt }) => succeed(prompt)
