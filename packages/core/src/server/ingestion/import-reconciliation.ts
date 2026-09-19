import { campaignImportClaimFingerprint } from './ids.js'
import type { ValidatedClaim } from './internal.js'
import { mergeClaims } from './claims.js'
import type { CampaignImportClaim } from './types.js'

export const reconcileCampaignImportClaims = (claims: ValidatedClaim[]) => {
	const merged = mergeClaims(
		[...claims].sort((left, right) => left.claimId.localeCompare(right.claimId))
	)
	const reconciled: CampaignImportClaim[] = merged.map((claim) => {
		const evidence = claim.evidence.map((item) => {
			if (!item.sourceId || !item.sourceRevisionId) {
				throw new Error('Campaign import evidence is missing source provenance')
			}
			return {
				...item,
				sourceId: item.sourceId,
				sourceRevisionId: item.sourceRevisionId
			}
		})
		return {
			...claim,
			evidence,
			claimFingerprint: campaignImportClaimFingerprint(claim)
		}
	})
	return { claims: reconciled }
}
