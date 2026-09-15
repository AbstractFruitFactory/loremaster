from pathlib import Path

index = Path('src/lib/server/ingestion/index.ts')
text = index.read_text()

old = "const normalize = (value: string) => value.trim().toLocaleLowerCase()\nconst wordTokens = (value: string) => normalize(value).match(/[\\p{L}\\p{N}]+/gu) ?? []"
new = """const normalize = (value: string) => value.trim().toLocaleLowerCase()

const displayTitle = (title: string) => {
\tconst value = title.trim().replace(/\\s+/g, ' ')
\tconst firstLetter = value.match(/\\p{L}/u)
\tif (!firstLetter || firstLetter.index === undefined) return value
\tconst index = firstLetter.index
\tconst letter = firstLetter[0]
\treturn `${value.slice(0, index)}${letter.toLocaleUpperCase()}${value.slice(index + letter.length)}`
}

const wordTokens = (value: string) => normalize(value).match(/[\\p{L}\\p{N}]+/gu) ?? []"""
assert old in text
text = text.replace(old, new, 1)

old = """\tconst capitalized = value.match(/\\b\\p{Lu}[\\p{L}\\p{N}'’.-]*/gu) ?? []
\treturn capitalized.some((word) => !/^(?:A|An|The)$/u.test(word))"""
new = "\treturn true"
assert old in text
text = text.replace(old, new, 1)

old = """\t\tfor (const occurrence of provisional) {
\t\t\tconst title = sessionCandidateTitle(occurrence, provisional)
\t\t\tif (!title) continue
\t\t\tconst key = `${occurrence.reference.type}:${normalize(title)}`"""
new = """\t\tfor (const occurrence of provisional) {
\t\t\tconst rawTitle = sessionCandidateTitle(occurrence, provisional)
\t\t\tif (!rawTitle) continue
\t\t\tconst title = displayTitle(rawTitle)
\t\t\tconst key = `${occurrence.reference.type}:${normalize(title)}`"""
assert old in text
text = text.replace(old, new, 1)

old = "\t\t\t\ttitle: entity.reference.label,\n\t\t\t\tcertainty: claim.certainty,"
new = "\t\t\t\ttitle: displayTitle(entity.reference.label),\n\t\t\t\tcertainty: claim.certainty,"
assert old in text
text = text.replace(old, new, 1)

needle = "Entity-reference labels do not need to occur verbatim in the cited lines, but do not resolve ambiguous identities by plausibility;"
replacement = "Entity-reference labels that may become document titles must be display-ready canonical names. Preserve capitalization established by the campaign, including proper names and acronyms. When the evidence establishes a descriptive entity but not a canonical capitalization, format the label as a readable title rather than copying sentence casing; for example, emit \\\"Service Tunnels Below Cathedral Square\\\" rather than \\\"service tunnels below Cathedral Square\\\". Do not mechanically rewrite an explicitly established unusual name. Entity-reference labels do not need to occur verbatim in the cited lines, but do not resolve ambiguous identities by plausibility;"
assert needle in text
text = text.replace(needle, replacement, 1)

index.write_text(text)

spec = Path('src/lib/server/ingestion/index.spec.ts')
text = spec.read_text()
marker = "\tit('uses a batched contextual resolver for relational references', async () => {"
test = r'''\tit('normalizes malformed new entity labels into display-ready document titles', async () => {
\t\tconst harness = setup(
\t\t\t[
\t\t\t\tclaim('The service tunnels below Cathedral Square are old.', {
\t\t\t\t\tcontent: 'The service tunnels below Cathedral Square are old.',
\t\t\t\t\tentityReferences: [
\t\t\t\t\t\t{ label: 'service tunnels below Cathedral Square', type: 'location' }
\t\t\t\t\t]
\t\t\t\t})
\t\t\t],
\t\t\t[]
\t\t)
\t\tconst draft = await runPromise(
\t\t\tanalyze(harness.operations, 'The service tunnels below Cathedral Square are old.')
\t\t)
\t\tconst location = draft.proposals.find(({ documentType }) => documentType === 'location')!

\t\texpect(location).toMatchObject({
\t\t\toperation: 'create-entity',
\t\t\ttitle: 'Service tunnels below Cathedral Square',
\t\t\tselected: true
\t\t})

\t\tawait runPromise(
\t\t\tharness.operations.commit({
\t\t\t\tcampaignId: draft.campaignId,
\t\t\t\tingestionId: draft.ingestionId,
\t\t\t\tselectedProposalIds: selectedIds(draft)
\t\t\t})
\t\t)
\t\tconst locationCreate = harness.createDocument.mock.calls.find(
\t\t\t([, input]) => input.type === 'location'
\t\t)?.[1]
\t\texpect(locationCreate).toMatchObject({
\t\t\tpath: 'Locations/service-tunnels-below-cathedral-square.md',
\t\t\tcontent:
\t\t\t\t'# Service tunnels below Cathedral Square\\n\\nThe service tunnels below Cathedral Square are old.'
\t\t})
\t})

'''
assert marker in text
text = text.replace(marker, test + marker, 1)
spec.write_text(text)

validation = Path('src/lib/server/ingestion/validation.spec.ts')
text = validation.read_text()
needle = "\t\t\texpect(system ?? '').toContain('Scene or section headings are editorial structure')\n"
replacement = needle + "\t\t\texpect(system ?? '').toContain('display-ready canonical names')\n\t\t\texpect(system ?? '').toContain('Service Tunnels Below Cathedral Square')\n"
assert needle in text
text = text.replace(needle, replacement, 1)
validation.write_text(text)
