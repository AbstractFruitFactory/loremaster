import type { EvidenceBackedClaim, TranscriptChunk, ValidatedClaim } from './internal.js'
import type { ExtractedSessionClaim, SessionProposal } from './types.js'
import type { VaultDocument } from '../vault/types.js'
import { candidateContext } from './proposals.js'
import { entityReferenceId } from './text.js'

export const extractionSystem =
	'Extract atomic campaign claims from the numbered transcript. Claims describe evidence, not how campaign canon should be stored: do not invent document titles or choose destination documents. Every claim must cite one or more supporting line ranges from the numbered transcript. Cite the smallest set of ranges that collectively supports the full normalized claim. The cited evidence itself must establish every identity, attribution, relationship, chronology statement, and coreference expressed in the claim: if you normalize pronouns or contextual references such as "she", "her", "it", or "E. Vey" into a named entity, expand the range or cite additional ranges that establish that identity. Do not rely on uncited surrounding lines to justify a normalized identity. Use multiple ranges when a conversation or separated statements are needed. Entity references are semantic identifiers, not quotations: include each distinct campaign entity the claim is materially about, using the clearest concise name or contextual identifier supported by the cited evidence. Only emit entity references for durable campaign entities with independent identity; do not turn every noun, physical feature, or piece of scenery into an entity. Use worldbuilding for a persistent setting concept with its own identity that is not primarily a person, place, item, or event, such as a religion, myth, ritual, magical phenomenon or system, social custom, law, prophecy, calendar, or institution. Do not use worldbuilding as a catch-all for isolated facts without a coherent persistent subject. A location reference must denote a distinct, persistent place that the campaign could reasonably refer to again by identity. Ordinary scenery or architectural/spatial fragments such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor are not Locations merely because something happens there. A room, chamber, tunnel, district, building, region, or descriptively named place may be a Location when the evidence establishes it as a distinct persistent place. Scene or section headings are editorial structure, not canonical entity names or evidence that a place has that identity; never use a heading alone to create or name an entity. If a claim concerns an environmental detail inside a place but no distinct sub-location is established, omit that location reference rather than inventing one. Entity-reference labels that may become document titles must be display-ready canonical names. Preserve capitalization established by the campaign, including proper names and acronyms. When the evidence establishes a descriptive entity but not a canonical capitalization, format the label as a readable title rather than copying sentence casing; for example, emit \"Service Tunnels Below Cathedral Square\" rather than \"service tunnels below Cathedral Square\". Do not mechanically rewrite an explicitly established unusual name. Entity-reference labels do not need to occur verbatim in the cited lines, but do not resolve ambiguous identities by plausibility; for example, keep "E. Vey" rather than changing it to "Elias Vey" unless the cited evidence establishes they are the same person. Avoid incidental or speculative entity references. Mark interpretation as inferred and mere names as mentions. Treat durable changes such as captures, rescues, deaths, discoveries, openings, item transfers, ritual changes, and escapes or disappearances as developments. Never strengthen an uncertain outcome: disappeared does not mean escaped, fell does not mean died, an attempted action does not mean it succeeded, and an unresolved fate must remain unresolved. For every development claim, set eventTitle to a concise factual label suitable for a timeline or list: usually 3-8 words and under 60 characters. The title must summarize only the claim content and must not introduce new identity, motive, causality, chronology, outcome, or interpretation. Prefer plain labels such as "Empty Bell cracks", "Talven\'s body discovered", or "Saltwater draft in Weaver\'s Cut" rather than full sentences or dramatic prose. For stable-fact and mention claims, set eventTitle to null. Do not turn a property or topic into an entity: use "Mara", not "Mara\'s age".'
export const validationSystem =
	"Independently verify candidate campaign claims against their cited transcript evidence. Judge claim content separately from semantic entity-reference metadata. For each candidateId, accepted refers only to whether the cited evidence collectively supports the exact claim content. Always return a reason. Use supported only when accepted is true. When rejected, use insufficient-evidence only when the exact existing claim appears supportable from other lines in the supplied transcript chunk and could be grounded by replacing or expanding the cited ranges without rewriting the claim. Use contradicted-by-evidence when the source contradicts the claim, unsupported-inference when the chunk does not establish the asserted identity, motive, causality, chronology, relationship, or other detail, and lost-attribution when the claim turns testimony, belief, rumor, a written statement, or uncertainty into objective truth. Reject the claim when its content itself adds unsupported motive, causality, chronology, identity, relationships, current state, attribution, or other details; turns a character claim into objective truth; or removes material uncertainty. In particular, if the claim content names a person or object where the cited evidence only contains an unresolved pronoun or abbreviation, classify it as insufficient-evidence only if other lines in this supplied chunk establish that identity; otherwise classify it as unsupported-inference. Separately return one decision for every supplied referenceId. Reference validation checks entityhood and type as well as topical relevance: accept a reference only when the cited evidence establishes that the claim concerns a distinct, persistent campaign entity of the specified type. A Location must be a distinct, persistent place that could reasonably be referred to again by identity. Reject Location references that are only ordinary scenery, architectural components, surfaces, directions, or incidental spatial descriptions, such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor, unless the evidence independently establishes that feature as a distinct persistent place. A room, chamber, tunnel, district, building, region, or descriptive place can be a valid Location when the evidence treats it as an independently identifiable place. Scene or section headings are editorial context and cannot by themselves establish a canonical Location name or identity. If a heading supplies a label that the actual transcript never establishes as the place's identity, reject that reference. An unsupported extra entity reference must not cause an otherwise supported claim to be rejected unless that same unsupported identity or detail is asserted in the claim content. Do not rewrite claims or entity references. For an accepted claim, keep certainty unchanged or downgrade explicit to inferred; never upgrade inferred to explicit. The surrounding numbered chunk may be used to decide whether missing context exists and therefore whether insufficient-evidence is the right rejection reason, but substantive support for an accepted claim must come from the cited evidence."
export const worldbuildingValidationGuidance =
	'A Worldbuilding reference is valid only for a persistent setting concept with its own identity that is not primarily a person, place, item, or event, such as a religion, myth, ritual, magical phenomenon or system, social custom, law, prophecy, calendar, or institution. Reject Worldbuilding references used merely as a catch-all for isolated facts without a coherent persistent subject.'
export const evidenceRepairSystem =
	'Repair only the evidence line ranges for candidate claims that were rejected solely because their current citations were insufficient. Do not rewrite claim content, kind, certainty, or entity references. For each candidateId, inspect the supplied numbered transcript chunk and return the smallest set of replacement line ranges that collectively supports the exact existing normalized claim, including every identity, attribution, relationship, chronology statement, and coreference it expresses. You may expand the original range or cite multiple separated ranges. Never repair an unsupported claim by weakening, reinterpreting, or changing it. If the exact claim cannot be fully grounded anywhere in the supplied chunk, return an empty evidence array. Never cite outside the supplied chunk.'
export const eventAuditSystem =
	'Audit the complete set of validated development events against the full numbered transcript. Return events only when a durable in-world development is missing or when a supplied event materially overstates the transcript and needs a faithful replacement. Every returned event must be a development with a concise factual eventTitle, preserve attribution and uncertainty, and cite the smallest supporting transcript line ranges. Never strengthen outcomes: disappeared is not escaped, fell is not died, attempted is not succeeded, and an unknown fate remains unknown. Put the ID of every materially unsupported or overstated supplied event in discardedEventIds and explain why; when an observed underlying event remains useful, also return a corrected replacement event. Identify duplicateGroups only when IDs describe the same in-world occurrence, not merely related actions. Choose as canonical the event that best preserves attribution, uncertainty, and scope. Captures, rescues, deaths, discoveries, openings, item transfers, ritual changes, and meaningful disappearances are durable developments that should not be omitted. Do not return already covered events merely to rephrase them, and use only supplied IDs in discard and duplicate decisions.'
export const chronologySystem =
	'Infer loose temporal constraints that anchor the supplied new session events into the existing campaign chronology. Return relation "before" only when the full session transcript establishes that sourceEventId happened before targetEventId in the campaign world. Return relation "during" when sourceEventId happened temporally within targetEventId; the target may be a broad event such as a war, reign, journey, or festival, and the system will promote it to a period. An event may have a during relationship and no before relationships at all. Events during the same period are not ordered relative to one another unless the transcript independently establishes a before relationship. Containment may be nested. Every returned relation must involve at least one new session event; existing events are supplied as anchors, not as an invitation to reorganize unrelated campaign history. Connect present-day events to existing chronology only when the transcript and campaign context support that continuation. Historical revelations may instead relate new historical events to relevant existing historical events or periods, independently of the present-day session chain. The result is not required to be a single linear sequence: events may be unrelated, disconnected, concurrent, contained by a period, or have an unknown order. Absence of a relation means the temporal relationship is not established. Events may share a predecessor, successor, or containing period without being ordered relative to one another. Present-day actions and scene transitions establish narrative order only when the transcript clearly indicates that one action or scene follows another; transcript position by itself is not enough. Transcript position also does not order historical accounts, flashbacks, legends, prophecies, plans, hypothetical events, or out-of-character discussion. Do not infer order from plausible causality or from a need to choose one earliest or latest event. Use explicit when temporal language or the described action directly establishes the relationship; use inferred for a relationship clearly supported by context without explicit temporal language. Return the complete transitive reduction of the supported chronology, not a sample of representative relationships. Completeness means including the direct boundary relationships needed to place every confidently ordered event in its connected sequence or branch. Sparse means omitting only unsupported order and relationships already implied transitively; it does not mean leaving supported adjacent events disconnected. Return exactly one coverage decision for every candidate event: connected when it participates in a supported relation, or intentionally-unplaced with a concrete reason when its placement is genuinely unknown. Use only supplied event IDs, and never create precedence cycles, containment cycles, or a before relationship between an event and a period that contains it.'

export const numberedChunkContent = (chunk: TranscriptChunk) =>
	chunk.content
		.split(/\r?\n/)
		.slice(0, chunk.endLine - chunk.startLine + 1)
		.map((line, index) => `${chunk.startLine + index} | ${line}`)
		.join('\n')

export const transcriptChunkPrompt = (chunk: TranscriptChunk) =>
	`## Transcript chunk ${chunk.chunkId}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${numberedChunkContent(chunk)}`

export const numberedTranscript = (transcript: string) =>
	transcript
		.split(/\r?\n/)
		.map((line, index) => `${index + 1} | ${line}`)
		.join('\n')

export const completeTranscriptChunk = (transcript: string): TranscriptChunk => ({
	chunkId: 'event-audit',
	content: transcript,
	startStringIndex: 0,
	endStringIndex: transcript.length,
	startLine: 1,
	endLine: transcript.split(/\r?\n/).length
})

export const evidenceRangesLabel = (claim: ExtractedSessionClaim) =>
	claim.evidence.map(({ startLine, endLine }) => `${startLine}-${endLine}`).join(', ') || 'none'

export const entityReferencesLabel = (claim: ExtractedSessionClaim) =>
	claim.entityReferences.map(({ label }) => label).join(', ') || 'none'

export const validationPrompt = (chunk: TranscriptChunk, claims: EvidenceBackedClaim[]) =>
	`${transcriptChunkPrompt(chunk)}\n\n## Candidate claims\n${JSON.stringify(
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

export const evidenceRepairPrompt = (chunk: TranscriptChunk, claims: EvidenceBackedClaim[]) =>
	`${transcriptChunkPrompt(chunk)}\n\n## Claims needing evidence repair\n${JSON.stringify(
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
export const eventAuditPrompt = (transcript: string, claims: ValidatedClaim[]) =>
	`## Full numbered transcript\n${numberedTranscript(transcript)}\n\n## Validated development events\n${JSON.stringify(
		claims
			.filter(({ kind }) => kind === 'development')
			.map((claim) => ({
				eventId: claim.claimId,
				title: claim.eventTitle,
				certainty: claim.certainty,
				content: claim.content,
				entityReferences: claim.entityReferences,
				evidence: claim.evidence.map(({ startLine, endLine, excerpt }) => ({
					startLine,
					endLine,
					excerpt
				}))
			})),
		null,
		2
	)}`
export const chronologyPrompt = (
	transcript: string,
	eventProposals: SessionProposal[],
	existingEvents: VaultDocument[]
) => {
	const eventsWithSuccessors = new Set(existingEvents.flatMap(({ after }) => after))
	return `## Full numbered transcript\n${numberedTranscript(transcript)}\n\n## Existing campaign events\n${JSON.stringify(
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
	)}\n\n## Candidate events\n${JSON.stringify(
		eventProposals.map((proposal) => ({
			eventId: proposal.proposalId,
			title: proposal.title,
			eventForm: 'occurrence',
			content: proposal.content,
			evidence: proposal.evidence.map(({ startLine, endLine, excerpt }) => ({
				startLine,
				endLine,
				excerpt
			}))
		})),
		null,
		2
	)}`
}
