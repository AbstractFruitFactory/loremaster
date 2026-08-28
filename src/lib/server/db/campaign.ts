import { eq } from 'drizzle-orm'
import { flatMap, map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { Campaign } from '../campaign/types'
import { fail, failure } from '../failure'
import { db } from '.'
import { campaigns } from './schema'

export const getById = (id: string) =>
	pipe(
		tryPromise({
			try: () => db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1),
			catch: (cause) => failure('database', 'getCampaignById', cause)
		}),
		map(([campaign]) => campaign)
	)

export const create = (input: Pick<Campaign, 'name' | 'description'>) =>
	pipe(
		tryPromise({
			try: () => db.insert(campaigns).values(input).returning(),
			catch: (cause) => failure('database', 'createCampaign', cause)
		}),
		flatMap(([campaign]) =>
			campaign
				? succeed(campaign)
				: fail('database', 'createCampaign', Error('Campaign could not be created'))
		)
	)

export const list = () =>
	tryPromise({
		try: () => db.select().from(campaigns),
		catch: (cause) => failure('database', 'listCampaigns', cause)
	})
