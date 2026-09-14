from pathlib import Path
import re

index_path = Path('src/lib/server/ingestion/index.ts')
source = index_path.read_text()

extraction = '''\tconst extractionSystem =
\t\t'Extract atomic campaign claims from the numbered transcript. Claims describe evidence, not how Lore should be stored: do not invent document titles or choose destination documents. Every claim must cite one or more supporting line ranges from the numbered transcript. Cite the smallest set of ranges that collectively supports the full normalized claim. The cited evidence itself must establish every identity, attribution, relationship, chronology statement, and coreference expressed in the claim: if you normalize pronouns or contextual references such as "she", "her", "it", or "E. Vey" into a named entity, expand the range or cite additional ranges that establish that identity. Do not rely on uncited surrounding lines to justify a normalized identity. Use multiple ranges when a conversation or separated statements are needed. Entity references are semantic identifiers, not quotations: include each distinct campaign entity the claim is materially about, using the clearest concise name or contextual identifier supported by the cited evidence. Only emit entity references for durable campaign entities with independent identity; do not turn every noun, physical feature, or piece of scenery into an entity. A location reference must denote a distinct, persistent place that the campaign could reasonably refer to again by identity. Ordinary scenery or architectural/spatial fragments such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor are not Locations merely because something happens there. A room, chamber, tunnel, district, building, region, or descriptively named place may be a Location when the evidence establishes it as a distinct persistent place. Scene or section headings are editorial structure, not canonical entity names or evidence that a place has that identity; never use a heading alone to create or name an entity. If a claim concerns an environmental detail inside a place but no distinct sub-location is established, omit that location reference rather than inventing one. Entity-reference labels do not need to occur verbatim in the cited lines, but do not resolve ambiguous identities by plausibility; for example, keep "E. Vey" rather than changing it to "Elias Vey" unless the cited evidence establishes they are the same person. Avoid incidental or speculative entity references. Mark interpretation as inferred and mere names as mentions. For every development claim, set eventTitle to a concise factual label suitable for a timeline or list: usually 3-8 words and under 60 characters. The title must summarize only the claim content and must not introduce new identity, motive, causality, chronology, or interpretation. Prefer plain labels such as "Empty Bell cracks", "Talven\\'s body discovered", or "Saltwater draft in Weaver\\'s Cut" rather than full sentences or dramatic prose. For stable-fact and mention claims, set eventTitle to null. Do not turn a property or topic into an entity: use "Mara", not "Mara\\'s age".'
'''

validation = '''\tconst validationSystem =
\t\t'Independently verify candidate campaign claims against their cited transcript evidence. Judge claim content separately from semantic entity-reference metadata. For each candidateId, accepted refers only to whether the cited evidence collectively supports the exact claim content. Always return a reason. Use supported only when accepted is true. When rejected, use insufficient-evidence only when the exact existing claim appears supportable from other lines in the supplied transcript chunk and could be grounded by replacing or expanding the cited ranges without rewriting the claim. Use contradicted-by-evidence when the source contradicts the claim, unsupported-inference when the chunk does not establish the asserted identity, motive, causality, chronology, relationship, or other detail, and lost-attribution when the claim turns testimony, belief, rumor, a written statement, or uncertainty into objective truth. Reject the claim when its content itself adds unsupported motive, causality, chronology, identity, relationships, current state, attribution, or other details; turns a character claim into objective truth; or removes material uncertainty. In particular, if the claim content names a person or object where the cited evidence only contains an unresolved pronoun or abbreviation, classify it as insufficient-evidence only if other lines in this supplied chunk establish that identity; otherwise classify it as unsupported-inference. Separately return one decision for every supplied referenceId. Reference validation checks entityhood and type as well as topical relevance: accept a reference only when the cited evidence establishes that the claim concerns a distinct, persistent campaign entity of the specified type. A Location must be a distinct, persistent place that could reasonably be referred to again by identity. Reject Location references that are only ordinary scenery, architectural components, surfaces, directions, or incidental spatial descriptions, such as a wall, door, floor, stone, inscription, corner, side of a room, nearby passage, staircase, or incidental service corridor, unless the evidence independently establishes that feature as a distinct persistent place. A room, chamber, tunnel, district, building, region, or descriptive place can be a valid Location when the evidence treats it as an independently identifiable place. Scene or section headings are editorial context and cannot by themselves establish a canonical Location name or identity. If a heading supplies a label that the actual transcript never establishes as the place\\'s identity, reject that reference. An unsupported extra entity reference must not cause an otherwise supported claim to be rejected unless that same unsupported identity or detail is asserted in the claim content. Do not rewrite claims or entity references. For an accepted claim, keep certainty unchanged or downgrade explicit to inferred; never upgrade inferred to explicit. The surrounding numbered chunk may be used to decide whether missing context exists and therefore whether insufficient-evidence is the right rejection reason, but substantive support for an accepted claim must come from the cited evidence.'
'''

source, count = re.subn(
    r"\tconst extractionSystem =\n.*?(?=\tconst validationSystem =)",
    extraction,
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('Could not replace extractionSystem')

source, count = re.subn(
    r"\tconst validationSystem =\n.*?(?=\tconst evidenceRepairSystem =)",
    validation,
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('Could not replace validationSystem')

index_path.write_text(source)

spec_path = Path('src/lib/server/ingestion/validation.spec.ts')
spec = spec_path.read_text()
test = '''

\tit('treats persistent entity identity as part of reference validation', async () => {
\t\tconst claim: ExtractedSessionClaim = {
\t\t\tkind: 'stable-fact',
\t\t\teventTitle: null,
\t\t\tcertainty: 'explicit',
\t\t\tcontent: 'The wall gives a hollow note when Brakka taps it.',
\t\t\tevidence: [{ startLine: 1, endLine: 1 }],
\t\t\tentityReferences: [{ label: 'Wall', type: 'location' }]
\t\t}
\t\tconst analyzer: AnalyzeSessionChunk = vi.fn(({ system }) => {
\t\t\texpect(system ?? '').toContain('Only emit entity references for durable campaign entities')
\t\t\texpect(system ?? '').toContain('A location reference must denote a distinct, persistent place')
\t\t\texpect(system ?? '').toContain('Scene or section headings are editorial structure')
\t\t\treturn succeed([claim])
\t\t})
\t\tconst validator: ValidateSessionClaims = vi.fn(({ system, prompt }) => {
\t\t\texpect(system ?? '').toContain('Reference validation checks entityhood and type')
\t\t\texpect(system ?? '').toContain('A Location must be a distinct, persistent place')
\t\t\texpect(system ?? '').toContain('Scene or section headings are editorial context')
\t\t\tconst [{ candidateId, certainty, entityReferences }] = JSON.parse(
\t\t\t\tprompt.split('\\n\\n## Candidate claims\\n').at(-1) ?? '[]'
\t\t\t) as {
\t\t\t\tcandidateId: string
\t\t\t\tcertainty: 'explicit' | 'inferred'
\t\t\t\tentityReferences: { referenceId: string }[]
\t\t\t}[]
\t\t\treturn succeed([
\t\t\t\t{
\t\t\t\t\tcandidateId,
\t\t\t\t\taccepted: true,
\t\t\t\t\tcertainty,
\t\t\t\t\treason: 'supported' as const,
\t\t\t\t\treferenceValidations: entityReferences.map(({ referenceId }) => ({
\t\t\t\t\t\treferenceId,
\t\t\t\t\t\taccepted: false
\t\t\t\t\t}))
\t\t\t\t}
\t\t\t])
\t\t})
\t\tconst warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
\t\tconst draft = await analyze(
\t\t\toperationsWith(analyzer, validator),
\t\t\t'DM: The wall gives a hollow note when Brakka taps it.'
\t\t)

\t\texpect(draft.proposals.some((proposal) => proposal.documentType === 'location')).toBe(false)
\t\texpect(draft.proposals[1]).toMatchObject({
\t\t\toperation: 'record-only',
\t\t\tcontent: claim.content
\t\t})
\t\texpect(draft.warnings[0]).toContain('[validator-rejected-reference]')
\t\texpect(draft.warnings[0]).toContain('Wall')
\t\twarn.mockRestore()
\t})
'''
marker = '\n})\n'
pos = spec.rfind(marker)
if pos == -1:
    raise SystemExit('Could not find validation describe terminator')
spec = spec[:pos] + test + spec[pos:]
spec_path.write_text(spec)
