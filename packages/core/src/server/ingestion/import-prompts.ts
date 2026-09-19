import type { EvidenceBackedClaim, TranscriptChunk } from './internal.js'
import {
	entityReferencesLabel,
	evidenceRangesLabel,
	evidenceRepairSystem,
	extractionSystem,
	numberedChunkContent,
	validationSystem,
	worldbuildingValidationGuidance
} from './prompts.js'
import type { VaultDocument } from '../vault/types.js'
import { candidateContext } from './proposals.js'
import { entityReferenceId } from './text.js'
import type { CampaignImportClaim, CampaignImportSource, SessionProposal } from './types.js'

export const importExtractionSystem = extractionSystem.replaceAll(
	'numbered transcript',
	'numbered source document'
)

export const importValidationSystem = `${validationSystem.replaceAll(
	'transcript',
	'source document'
)} ${worldbuildingValidationGuidance}`

export const importEvidenceRepairSystem = evidenceRepairSystem.replaceAll(
	'transcript',
	'source document'
)

type SourcePromptIdentity = Pick<
	CampaignImportSource,
	'displayName' | 'sourceId' | 'sourceRevisionId'
>

export const sourceChunkPrompt = (source: SourcePromptIdentity, chunk: TranscriptChunk) =>
	`## Source document ${JSON.stringify(source.displayName)}\nSource ID: ${source.sourceId}\nSource revision ID: ${source.sourceRevisionId}\n## Source chunk ${chunk.chunkId}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${numberedChunkContent(chunk)}`

export const importValidationPrompt = (
	source: SourcePromptIdentity,
	chunk: TranscriptChunk,
	claims: EvidenceBackedClaim[]
) =>
	`${sourceChunkPrompt(source, chunk)}\n\n## Candidate claims\n${JSON.stringify(
		claims.map(({ candidateId, claim, evidence }) => ({
			candidateId,
			kind: claim.kind,
			certainty: claim.certainty,
			content: claim.content,
			entityReferences: claim.entityReferences.map((reference, referenceIndex) => ({
				referenceId: entityReferenceId(candidateId, referenceIndex),
				...reference
			})),
			evidence: evidence.map(({ startLine, endLine, excerpt }) => ({
				startLine,
				endLine,
				excerpt
			}))
		})),
		null,
		2
	)}`

export const importEvidenceRepairPrompt = (
	source: SourcePromptIdentity,
	chunk: TranscriptChunk,
	claims: EvidenceBackedClaim[]
) =>
	`${sourceChunkPrompt(source, chunk)}\n\n## Claims needing evidence repair\n${JSON.stringify(
		claims.map(({ candidateId, claim, evidence }) => ({
			candidateId,
			content: claim.content,
			entityReferences: claim.entityReferences,
			currentEvidence: evidence.map(({ startLine, endLine, excerpt }) => ({
				startLine,
				endLine,
				excerpt
			}))
		})),
		null,
		2
	)}`

export const importChronologySystem =
	'Infer loose temporal constraints for committed events created or updated by a campaign import, using existing campaign events only as anchors. Return "before" only when accepted claim evidence establishes that sourceEventId happened before targetEventId, and return "during" only when it establishes that sourceEventId happened temporally within targetEventId. Every relationship must involve at least one committed imported event and must cite one or more supplied accepted claim IDs that support that exact relationship. Infer relationships only from explicit dates, explicit temporal language, or genuinely supported implications in the cited accepted evidence and existing chronology. Never use upload order, source order, document order, array order, event-list order, claim-list order, line-number order, or line order across different sources as temporal evidence. Source documents are heterogeneous campaign materials whose physical sequence has no narrative meaning. Unknown order is valid: events may remain intentionally unplaced, unrelated, concurrent, or in disconnected chronology components. Do not invent links to force a single timeline. Existing event after and during fields are established anchor constraints, not permission to reorganize unrelated history. Use explicit when dates or temporal language directly establish the relationship; otherwise use inferred only for a genuinely supported implication. Return the complete transitive reduction of supported chronology. Return exactly one coverage decision for every committed imported event: connected when it participates in a supported relationship, or intentionally-unplaced with a concrete reason when its placement is unknown. Use only supplied event and claim IDs, and never create precedence cycles, containment cycles, or a before relationship between an event and a period that contains it.'

export const importChronologyPrompt = (
	claims: CampaignImportClaim[],
	eventProposals: SessionProposal[],
	existingEvents: VaultDocument[]
) => {
	const eventsWithSuccessors = new Set(existingEvents.flatMap(({ after }) => after))
	return `## Accepted imported temporal claims
${JSON.stringify(
	claims.map(({ claimId, kind, eventTitle, certainty, content, entityReferences, evidence }) => ({
		claimId,
		kind,
		eventTitle,
		certainty,
		content,
		entityReferences,
		evidence: evidence.map(
			({
				sourceId,
				sourceRevisionId,
				excerpt,
				chunkId,
				startStringIndex,
				endStringIndex,
				startLine,
				endLine
			}) => ({
				sourceId,
				sourceRevisionId,
				excerpt,
				chunkId,
				startStringIndex,
				endStringIndex,
				startLine,
				endLine
			})
		)
	})),
	null,
	2
)}

## Existing campaign event anchors
${JSON.stringify(
	existingEvents.map((document) => ({
		eventId: document.id,
		title: document.title,
		context: candidateContext(document),
		afterEventIds: document.after,
		duringEventIds: document.during,
		eventForm: document.eventForm ?? 'occurrence',
		isChronologyFrontier: !eventsWithSuccessors.has(document.id)
	})),
	null,
	2
)}

## Committed imported events
${JSON.stringify(
	eventProposals.map((proposal) => ({
		eventId: proposal.proposalId,
		title: proposal.title,
		eventForm: 'occurrence',
		content: proposal.content,
		acceptedClaimIds: proposal.claimIds
	})),
	null,
	2
)}`
}

export { entityReferencesLabel, evidenceRangesLabel }
