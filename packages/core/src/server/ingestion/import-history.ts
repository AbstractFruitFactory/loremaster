import type { Effect } from 'effect/Effect'
import type { Failure } from '../failure.js'
import type {
	CampaignImportClaimProvenanceRecord,
	CampaignImportChronologyProvenanceRecord,
	CampaignImportSource
} from './types.js'

export type CampaignImportHistoryRepository = {
	getAcceptedClaimFingerprints: (
		campaignId: string,
		claimFingerprints: string[]
	) => Effect<Set<string>, Failure>
	recordProvenance: (
		campaignId: string,
		ingestionId: string,
		records: CampaignImportClaimProvenanceRecord[]
	) => Effect<void, Failure>
	recordChronologyProvenance: (
		campaignId: string,
		ingestionId: string,
		records: CampaignImportChronologyProvenanceRecord[]
	) => Effect<void, Failure>
	persistSourceRevisions: (
		campaignId: string,
		ingestionId: string,
		sources: CampaignImportSource[]
	) => Effect<void, Failure>
	verifyPermanence: (
		campaignId: string,
		ingestionId: string,
		input: {
			sources: CampaignImportSource[]
			records: CampaignImportClaimProvenanceRecord[]
		}
	) => Effect<void, Failure>
	verifyChronologyPermanence: (
		campaignId: string,
		ingestionId: string,
		records: CampaignImportChronologyProvenanceRecord[]
	) => Effect<void, Failure>
}
