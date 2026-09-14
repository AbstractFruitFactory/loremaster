from pathlib import Path

index_path = Path('src/lib/server/ingestion/index.ts')
source = index_path.read_text()

old = """\t\tconst planned: PlannedMutation[] = []
\t\tconst createPaths = new Set<string>()
\t\tfor (const proposal of resolvedSelected) {
"""
new = """\t\tconst planned: PlannedMutation[] = []
\t\tconst createPaths = new Set(documents.map(({ path }) => path))
\t\tconst nextCreatePath = (proposal: SessionProposal) => {
\t\t\tconst directory = categoryDirectory[proposal.documentType]
\t\t\tconst slug = toSlug(proposal.title)
\t\t\tlet suffix = 1
\t\t\tlet path = `${directory}/${slug}.md`
\t\t\twhile (createPaths.has(path)) {
\t\t\t\tsuffix += 1
\t\t\t\tpath = `${directory}/${slug}-${suffix}.md`
\t\t\t}
\t\t\tcreatePaths.add(path)
\t\t\treturn path
\t\t}
\t\tfor (const proposal of resolvedSelected) {
"""
if old not in source:
    raise SystemExit('Could not find mutation-plan setup')
source = source.replace(old, new, 1)

old = """\t\t\tconst path = `${categoryDirectory[proposal.documentType]}/${toSlug(proposal.title)}.md`
\t\t\tif (createPaths.has(path) || documents.some((document) => document.path === path)) {
\t\t\t\treturn failEffect({
\t\t\t\t\tdomain: 'ingestion',
\t\t\t\t\toperation: 'commit',
\t\t\t\t\tcause: { reason: 'duplicateDocumentPath', path }
\t\t\t\t} satisfies Failure)
\t\t\t}
\t\t\tcreatePaths.add(path)
\t\t\tplanned.push({ proposal, documentId, path, after })
"""
new = """\t\t\tconst path = nextCreatePath(proposal)
\t\t\tplanned.push({ proposal, documentId, path, after })
"""
if old not in source:
    raise SystemExit('Could not find duplicate path rejection')
source = source.replace(old, new, 1)
index_path.write_text(source)

spec_path = Path('src/lib/server/ingestion/index.spec.ts')
spec = spec_path.read_text()
marker = "\n\tit('never allows mention-only evidence to be committed as a mutation', async () => {"
if marker not in spec:
    raise SystemExit('Could not find test insertion point')

test = """

\tit('allocates unique paths when selected documents have duplicate generated names', async () => {
\t\tconst duplicateEvent = (content: string): ExtractedSessionClaim =>
\t\t\tclaim(content, {
\t\t\t\tkind: 'development',
\t\t\t\teventTitle: 'Ceiling trap disabled',
\t\t\t\tcontent,
\t\t\t\tentityReferences: []
\t\t\t})
\t\tconst harness = setup(
\t\t\t[
\t\t\t\tduplicateEvent('The party disabled the ceiling trap in the west hall.'),
\t\t\t\tduplicateEvent('The party disabled another ceiling trap in the east hall.')
\t\t\t],
\t\t\t[]
\t\t)
\t\tconst draft = await runPromise(
\t\t\tanalyze(
\t\t\t\tharness.operations,
\t\t\t\t'The party disabled the ceiling trap in the west hall.\\nThe party disabled another ceiling trap in the east hall.'
\t\t\t)
\t\t)

\t\tawait runPromise(
\t\t\tharness.operations.commit({
\t\t\t\tcampaignId: draft.campaignId,
\t\t\t\tingestionId: draft.ingestionId,
\t\t\t\tselectedProposalIds: selectedIds(draft)
\t\t\t})
\t\t)

\t\tconst eventPaths = harness.createDocument.mock.calls
\t\t\t.map(([, input]) => input)
\t\t\t.filter(({ type }) => type === 'event')
\t\t\t.map(({ path }) => path)
\t\texpect(eventPaths).toEqual([
\t\t\t'Events/ceiling-trap-disabled.md',
\t\t\t'Events/ceiling-trap-disabled-2.md'
\t\t])
\t})

\tit('avoids paths already used by existing documents', async () => {
\t\tconst existingEvent = document('old-event', 'Old event', [], 'event', {
\t\t\tpath: 'Events/ceiling-trap-disabled.md'
\t\t})
\t\tconst harness = setup(
\t\t\t[
\t\t\t\tclaim('The party disabled the ceiling trap.', {
\t\t\t\t\tkind: 'development',
\t\t\t\t\teventTitle: 'Ceiling trap disabled',
\t\t\t\t\tcontent: 'The party disabled the ceiling trap.',
\t\t\t\t\tentityReferences: []
\t\t\t\t})
\t\t\t],
\t\t\t[existingEvent]
\t\t)
\t\tconst draft = await runPromise(analyze(harness.operations, 'The party disabled the ceiling trap.'))

\t\tawait runPromise(
\t\t\tharness.operations.commit({
\t\t\t\tcampaignId: draft.campaignId,
\t\t\t\tingestionId: draft.ingestionId,
\t\t\t\tselectedProposalIds: selectedIds(draft)
\t\t\t})
\t\t)

\t\tconst eventCreate = harness.createDocument.mock.calls.find(([, input]) => input.type === 'event')?.[1]
\t\texpect(eventCreate?.path).toBe('Events/ceiling-trap-disabled-2.md')
\t})
"""
spec = spec.replace(marker, test + marker, 1)
spec_path.write_text(spec)
