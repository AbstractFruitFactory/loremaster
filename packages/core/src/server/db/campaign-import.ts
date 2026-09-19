import { and, eq, inArray } from 'drizzle-orm'
import { map, succeed, tryPromise } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { failure } from '../failure.js'
import type { CampaignImportHistoryRepository } from '../ingestion/import-history.js'
import type {
	CampaignImportClaimProvenanceRecord,
	CampaignImportChronologyProvenanceRecord,
	CampaignImportSource
} from '../ingestion/types.js'
import { db } from './index.js'
import {
	campaignImportAcceptedClaims,
	campaignImportChronologyProvenance,
	campaignImportClaimProvenance,
	campaignImportSourceRevisions
} from './schema.js'

const sourceRevisionKey = (sourceId: string, sourceRevisionId: string) =>
	`${sourceId}:${sourceRevisionId}`

const sourceRevisionValues = (
	campaignId: string,
	ingestionId: string,
	source: CampaignImportSource
) => ({
	campaignId,
	ingestionId,
	sourceId: source.sourceId,
	sourceRevisionId: source.sourceRevisionId,
	displayName: source.displayName,
	title: source.title,
	mediaType: source.mediaType,
	contentHash: source.contentHash,
	byteLength: source.byteLength
})

const uniqueSources = (
	records: (CampaignImportClaimProvenanceRecord | CampaignImportChronologyProvenanceRecord)[]
) => [
	...new Map(
		records.map(({ source }) => [
			sourceRevisionKey(source.sourceId, source.sourceRevisionId),
			source
		])
	).values()
]

const uniqueClaims = (
	records: (CampaignImportClaimProvenanceRecord | CampaignImportChronologyProvenanceRecord)[]
) => [...new Map(records.map(({ claim }) => [claim.claimFingerprint, claim])).values()]

export const campaignImportHistoryRepository: CampaignImportHistoryRepository = {
	getAcceptedClaimFingerprints: (campaignId, claimFingerprints) => {
		if (!claimFingerprints.length) return succeed(new Set())
		return pipe(
			tryPromise({
				try: () =>
					db
						.select({ claimFingerprint: campaignImportAcceptedClaims.claimFingerprint })
						.from(campaignImportAcceptedClaims)
						.where(
							and(
								eq(campaignImportAcceptedClaims.campaignId, campaignId),
								inArray(campaignImportAcceptedClaims.claimFingerprint, claimFingerprints)
							)
						),
				catch: (cause) => failure('database', 'getCampaignImportAcceptedClaims', cause)
			}),
			map((rows) => new Set(rows.map(({ claimFingerprint }) => claimFingerprint)))
		)
	},
	recordProvenance: (campaignId, ingestionId, records) => {
		if (!records.length) return succeed(undefined)
		return tryPromise({
			try: () =>
				db.transaction(async (transaction) => {
					await transaction
						.insert(campaignImportSourceRevisions)
						.values(
							uniqueSources(records).map((source) =>
								sourceRevisionValues(campaignId, ingestionId, source)
							)
						)
						.onConflictDoNothing()
					await transaction
						.insert(campaignImportAcceptedClaims)
						.values(
							uniqueClaims(records).map((claim) => ({
								campaignId,
								claimFingerprint: claim.claimFingerprint,
								kind: claim.kind,
								eventTitle: claim.eventTitle,
								content: claim.content,
								entityReferences: claim.entityReferences
							}))
						)
						.onConflictDoNothing()
					await transaction
						.insert(campaignImportClaimProvenance)
						.values(
							records.map(({ claim, source, documentId, vaultRevisionId, evidence }) => ({
								campaignId,
								claimFingerprint: claim.claimFingerprint,
								sourceId: source.sourceId,
								sourceRevisionId: source.sourceRevisionId,
								documentId,
								vaultRevisionId,
								excerpt: evidence.excerpt,
								startStringIndex: evidence.startStringIndex,
								endStringIndex: evidence.endStringIndex,
								startLine: evidence.startLine,
								endLine: evidence.endLine
							}))
						)
						.onConflictDoNothing()
				}),
			catch: (cause) => failure('database', 'recordCampaignImportProvenance', cause)
		})
	},
	recordChronologyProvenance: (campaignId, ingestionId, records) => {
		if (!records.length) return succeed(undefined)
		return tryPromise({
			try: () =>
				db.transaction(async (transaction) => {
					await transaction
						.insert(campaignImportSourceRevisions)
						.values(
							uniqueSources(records).map((source) =>
								sourceRevisionValues(campaignId, ingestionId, source)
							)
						)
						.onConflictDoNothing()
					await transaction
						.insert(campaignImportAcceptedClaims)
						.values(
							uniqueClaims(records).map((claim) => ({
								campaignId,
								claimFingerprint: claim.claimFingerprint,
								kind: claim.kind,
								eventTitle: claim.eventTitle,
								content: claim.content,
								entityReferences: claim.entityReferences
							}))
						)
						.onConflictDoNothing()
					await transaction
						.insert(campaignImportChronologyProvenance)
						.values(
							records.map(
								({
									chronologyId,
									relation,
									sourceEventId,
									targetEventId,
									affectedDocumentId,
									vaultRevisionId,
									claim,
									source,
									evidence
								}) => ({
									campaignId,
									ingestionId,
									chronologyId,
									relation,
									sourceEventId,
									targetEventId,
									affectedDocumentId,
									vaultRevisionId,
									claimId: claim.claimId,
									claimFingerprint: claim.claimFingerprint,
									sourceId: source.sourceId,
									sourceRevisionId: source.sourceRevisionId,
									excerpt: evidence.excerpt,
									startStringIndex: evidence.startStringIndex,
									endStringIndex: evidence.endStringIndex,
									startLine: evidence.startLine,
									endLine: evidence.endLine
								})
							)
						)
						.onConflictDoNothing()
				}),
			catch: (cause) => failure('database', 'recordCampaignImportChronologyProvenance', cause)
		})
	},
	persistSourceRevisions: (campaignId, ingestionId, sources) =>
		tryPromise({
			try: async () => {
				if (!sources.length) return
				await db
					.insert(campaignImportSourceRevisions)
					.values(sources.map((source) => sourceRevisionValues(campaignId, ingestionId, source)))
					.onConflictDoNothing()
			},
			catch: (cause) => failure('database', 'persistCampaignImportSourceRevisions', cause)
		}),
	verifyPermanence: (campaignId, ingestionId, { sources, records }) =>
		tryPromise({
			try: () =>
				db.transaction(async (transaction) => {
					const sourceIds = [...new Set(sources.map(({ sourceId }) => sourceId))]
					const sourceRows = sourceIds.length
						? await transaction
								.select()
								.from(campaignImportSourceRevisions)
								.where(
									and(
										eq(campaignImportSourceRevisions.campaignId, campaignId),
										eq(campaignImportSourceRevisions.ingestionId, ingestionId),
										inArray(campaignImportSourceRevisions.sourceId, sourceIds)
									)
								)
						: []
					const sourceByRevision = new Map(
						sourceRows.map((row) => [sourceRevisionKey(row.sourceId, row.sourceRevisionId), row])
					)
					const missingSourceRevisionIds = sources.flatMap((source) => {
						const row = sourceByRevision.get(
							sourceRevisionKey(source.sourceId, source.sourceRevisionId)
						)
						return row &&
							row.displayName === source.displayName &&
							row.title === source.title &&
							row.mediaType === source.mediaType &&
							row.contentHash === source.contentHash &&
							row.byteLength === source.byteLength
							? []
							: [source.sourceRevisionId]
					})

					const provenanceRows = sourceIds.length
						? await transaction
								.select()
								.from(campaignImportClaimProvenance)
								.where(
									and(
										eq(campaignImportClaimProvenance.campaignId, campaignId),
										inArray(campaignImportClaimProvenance.sourceId, sourceIds)
									)
								)
						: []
					const provenanceKey = ({
						claimFingerprint,
						sourceId,
						sourceRevisionId,
						documentId,
						vaultRevisionId,
						excerpt,
						startStringIndex,
						endStringIndex,
						startLine,
						endLine
					}: {
						claimFingerprint: string
						sourceId: string
						sourceRevisionId: string
						documentId: string
						vaultRevisionId: string
						excerpt: string
						startStringIndex: number
						endStringIndex: number
						startLine: number
						endLine: number
					}) =>
						[
							claimFingerprint,
							sourceId,
							sourceRevisionId,
							documentId,
							vaultRevisionId,
							excerpt,
							startStringIndex,
							endStringIndex,
							startLine,
							endLine
						].join('\0')
					const permanentProvenance = new Set(provenanceRows.map(provenanceKey))
					const missingEvidenceLocators = records.flatMap(
						({ claim, source, documentId, vaultRevisionId, evidence }) => {
							const key = provenanceKey({
								claimFingerprint: claim.claimFingerprint,
								sourceId: source.sourceId,
								sourceRevisionId: source.sourceRevisionId,
								documentId,
								vaultRevisionId,
								excerpt: evidence.excerpt,
								startStringIndex: evidence.startStringIndex,
								endStringIndex: evidence.endStringIndex,
								startLine: evidence.startLine,
								endLine: evidence.endLine
							})
							return permanentProvenance.has(key) ? [] : [key]
						}
					)
					if (missingSourceRevisionIds.length || missingEvidenceLocators.length) {
						const cause = new Error('Campaign import permanence verification failed')
						cause.name = 'CampaignImportPermanenceError'
						Object.assign(cause, { missingSourceRevisionIds, missingEvidenceLocators })
						throw cause
					}
				}),
			catch: (cause) => failure('database', 'verifyCampaignImportPermanence', cause)
		}),
	verifyChronologyPermanence: (campaignId, ingestionId, records) =>
		tryPromise({
			try: async () => {
				const rows = records.length
					? await db
							.select()
							.from(campaignImportChronologyProvenance)
							.where(
								and(
									eq(campaignImportChronologyProvenance.campaignId, campaignId),
									eq(campaignImportChronologyProvenance.ingestionId, ingestionId)
								)
							)
					: []
				const key = ({
					chronologyId,
					relation,
					sourceEventId,
					targetEventId,
					affectedDocumentId,
					vaultRevisionId,
					claimId,
					claimFingerprint,
					sourceId,
					sourceRevisionId,
					excerpt,
					startStringIndex,
					endStringIndex,
					startLine,
					endLine
				}: {
					chronologyId: string
					relation: string
					sourceEventId: string
					targetEventId: string
					affectedDocumentId: string
					vaultRevisionId: string
					claimId: string
					claimFingerprint: string
					sourceId: string
					sourceRevisionId: string
					excerpt: string
					startStringIndex: number
					endStringIndex: number
					startLine: number
					endLine: number
				}) =>
					[
						chronologyId,
						relation,
						sourceEventId,
						targetEventId,
						affectedDocumentId,
						vaultRevisionId,
						claimId,
						claimFingerprint,
						sourceId,
						sourceRevisionId,
						excerpt,
						startStringIndex,
						endStringIndex,
						startLine,
						endLine
					].join('\0')
				const permanent = new Set(rows.map(key))
				const missingChronologyProvenance = records.flatMap(
					({
						chronologyId,
						relation,
						sourceEventId,
						targetEventId,
						affectedDocumentId,
						vaultRevisionId,
						claim,
						source,
						evidence
					}) => {
						const expected = key({
							chronologyId,
							relation,
							sourceEventId,
							targetEventId,
							affectedDocumentId,
							vaultRevisionId,
							claimId: claim.claimId,
							claimFingerprint: claim.claimFingerprint,
							sourceId: source.sourceId,
							sourceRevisionId: source.sourceRevisionId,
							excerpt: evidence.excerpt,
							startStringIndex: evidence.startStringIndex,
							endStringIndex: evidence.endStringIndex,
							startLine: evidence.startLine,
							endLine: evidence.endLine
						})
						return permanent.has(expected) ? [] : [expected]
					}
				)
				if (missingChronologyProvenance.length) {
					const cause = new Error('Campaign import chronology permanence verification failed')
					cause.name = 'CampaignImportPermanenceError'
					Object.assign(cause, { missingChronologyProvenance })
					throw cause
				}
			},
			catch: (cause) => failure('database', 'verifyCampaignImportChronologyPermanence', cause)
		})
}
