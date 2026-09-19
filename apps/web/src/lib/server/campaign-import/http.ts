import { error } from '@sveltejs/kit'
import { match, runPromise, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { campaign } from '#lib/server/app.js'
import { logFailure } from '#lib/server/failure.js'
import type { Failure } from '@loremaster/core/server/failure'
import { isCampaignImportNotFound } from '@loremaster/core/server/ingestion/storage'

export const runCore = <Value>(
	effect: Effect<Value, Failure>,
	onFailure: (failure: Failure) => never
): Promise<Value> =>
	runPromise(
		pipe(
			effect,
			match({
				onFailure,
				onSuccess: (value) => value
			})
		)
	)

export const campaignImportNotFoundHttpError = (failure: Failure, message: string) =>
	isCampaignImportNotFound(failure.cause)
		? {
				status: 404 as const,
				message
			}
		: undefined

export const failCampaignImportRead = (
	failure: Failure,
	notFoundMessage: string,
	fallbackMessage: string
): never => {
	logFailure(failure)
	const mapped = campaignImportNotFoundHttpError(failure, notFoundMessage)
	if (mapped) error(mapped.status, mapped.message)
	error(500, fallbackMessage)
}

export const authorizeCampaignImport = (campaignId: string) =>
	runCore(campaign.getCampaign(campaignId), (failure) => {
		if (failure.domain === 'campaign' && failure.operation === 'getCampaign') {
			error(404, `Campaign "${campaignId}" was not found`)
		}
		logFailure(failure)
		error(500, 'Unable to access this campaign')
	})
