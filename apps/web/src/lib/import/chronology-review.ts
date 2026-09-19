import type {
	CampaignImportChronologyProposal,
	CampaignImportPhase,
	SessionChronologyEndpoint
} from '#lib/server/ingestion/types.js'
import type { WorkflowLifecycle } from '@loremaster/core/workflows/contracts'

export type CampaignImportChronologyGroup = {
	affected: SessionChronologyEndpoint
	relationships: CampaignImportChronologyProposal[]
}

export const campaignImportChronologyCommitUiState = ({
	phase,
	lifecycle,
	retryable
}: {
	phase: CampaignImportPhase
	lifecycle: WorkflowLifecycle
	retryable: boolean
}) => {
	const started = lifecycle !== 'not-started' || phase === 'chronology-committing'
	return {
		started,
		retryable: started && retryable,
		active: lifecycle === 'queued' || lifecycle === 'running'
	}
}

export const groupCampaignImportChronology = (
	relationships: readonly CampaignImportChronologyProposal[]
): CampaignImportChronologyGroup[] => {
	const groups = new Map<string, CampaignImportChronologyGroup>()
	for (const relationship of relationships) {
		const current = groups.get(relationship.source.eventId)
		if (current) {
			current.relationships.push(relationship)
		} else {
			groups.set(relationship.source.eventId, {
				affected: relationship.source,
				relationships: [relationship]
			})
		}
	}
	return [...groups.values()]
}

export const initialCampaignImportChronologySelections = (
	relationships: readonly CampaignImportChronologyProposal[]
) =>
	Object.fromEntries(
		relationships.map(({ chronologyId, selected }) => [chronologyId, selected])
	) as Record<string, boolean>

export const selectedCampaignImportChronologyIds = (
	relationships: readonly CampaignImportChronologyProposal[],
	selections: Readonly<Record<string, boolean>>
) =>
	relationships
		.filter(({ chronologyId }) => selections[chronologyId] ?? false)
		.map(({ chronologyId }) => chronologyId)
