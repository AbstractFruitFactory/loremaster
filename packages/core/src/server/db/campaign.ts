import { eq } from 'drizzle-orm'
import { flatMap, map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import type { Campaign } from '../campaign/types.js'
import { fail, failure } from '../failure.js'
import { db } from './index.js'
import { campaigns } from './schema.js'

export const getById = (id: string) =>
	pipe(
		tryPromise({
			try: () =>
				db
					.select({
						id: campaigns.id,
						name: campaigns.name,
						description: campaigns.description,
						createdAt: campaigns.createdAt
					})
					.from(campaigns)
					.where(eq(campaigns.id, id))
					.limit(1),
			catch: (cause) => failure('database', 'getCampaignById', cause)
		}),
		map(([campaign]) => campaign)
	)

export const create = (input: Pick<Campaign, 'name' | 'description'> & { ownerId: string }) =>
	pipe(
		tryPromise({
			try: () =>
				db.insert(campaigns).values(input).returning({
					id: campaigns.id,
					name: campaigns.name,
					description: campaigns.description,
					createdAt: campaigns.createdAt
				}),
			catch: (cause) => failure('database', 'createCampaign', cause)
		}),
		flatMap(([campaign]) =>
			campaign
				? succeed(campaign)
				: fail('database', 'createCampaign', Error('Campaign could not be created'))
		)
	)

export const list = (ownerId: string) =>
	tryPromise({
		try: () =>
			db
				.select({
					id: campaigns.id,
					name: campaigns.name,
					description: campaigns.description,
					createdAt: campaigns.createdAt
				})
				.from(campaigns)
				.where(eq(campaigns.ownerId, ownerId)),
		catch: (cause) => failure('database', 'listCampaigns', cause)
	})
