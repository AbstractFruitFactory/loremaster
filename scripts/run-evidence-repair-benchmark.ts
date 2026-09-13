import { readFile } from 'node:fs/promises'
import OpenAI from 'openai'
import { runPromise, succeed } from 'effect/Effect'
import { openAiProvider } from '../src/lib/server/ai/providers/openai'
import { sessionIngestion } from '../src/lib/server/ingestion'
import { filesystemIngestionStorage } from '../src/lib/server/ingestion/storage'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

const transcript = await readFile('scripts/fixtures/blackwater-benchmark.txt', 'utf8')
const provider = openAiProvider(new OpenAI({ apiKey }))

const attributionInstruction =
	'Preserve epistemic attribution in every extracted claim. If information is presented as dialogue, testimony, belief, rumor, legend, hearsay, or a written source, keep that source in the normalized claim content. Never rewrite "Ilyra says X" as "X", "Nell believes or reports X" as "X", "a letter states X" as "X", or "a legend says X" as "X". Only state X directly as an objective world fact when the transcript itself establishes X authoritatively. The certainty field describes how directly the full attributed claim is supported by the evidence; explicit does not mean that an embedded proposition is objectively true.'

const repairLogs: unknown[] = []
const originalInfo = console.info
console.info = (...args: unknown[]) => {
	if (args[0] === '[session-ingestion] repaired claim evidence') {
		repairLogs.push(args[1])
	}
	originalInfo(...args)
}

const operations = sessionIngestion({
	ai: {
		analysisModel: provider.models.sessionAnalysis,
		analyzeSessionChunk: (input) =>
			provider.analyzeSessionChunk({
				...input,
				system: `${input.system}\n\n${attributionInstruction}`
			}),
		validateSessionClaims: provider.validateSessionClaims,
		repairSessionClaimEvidence: provider.repairSessionClaimEvidence,
		resolveSessionEntities: provider.resolveSessionEntities
	},
	storage: filesystemIngestionStorage('/tmp/loremaster-evidence-repair-benchmark'),
	vault: {
		getDocuments: () => succeed([]),
		createDocument: () => succeed(null as never),
		updateDocument: () => succeed(null as never)
	}
})

const draft = await runPromise(
	operations.analyze({
		campaignId: 'blackwater-evidence-repair-benchmark',
		title: 'The Bell Beneath Blackwater',
		transcript
	})
)

console.info = originalInfo

const proposals = draft.proposals.filter(({ documentType }) => documentType !== 'session')
const targets = [
	{
		name: 'Mara / Edric father relationship',
		matches: (content: string) =>
			/Mara Vale/i.test(content) && /Edric Vale/i.test(content) && /(father|daughter)/i.test(content)
	},
	{
		name: 'black key opens Lower Gate',
		matches: (content: string) =>
			/black (iron )?key/i.test(content) && /Lower Gate/i.test(content) && /open/i.test(content)
	},
	{
		name: 'Blackwater flood 31 years ago',
		matches: (content: string) => /Blackwater flood/i.test(content) && /thirty-one|31/i.test(content)
	},
	{
		name: 'lockbox contains black iron key',
		matches: (content: string) =>
			/(lockbox|silver box)/i.test(content) && /black iron key/i.test(content) && /(contain|inside|contained)/i.test(content)
	},
	{
		name: 'Seraphine drowned 29 years ago',
		matches: (content: string) => /Seraphine/i.test(content) && /drowned/i.test(content) && /twenty-nine|29/i.test(content)
	},
	{
		name: 'letter three days after Seraphine death',
		matches: (content: string) =>
			/letter/i.test(content) && /three days/i.test(content) && /Seraphine/i.test(content) && /death|drowned/i.test(content)
	}
]

const targetResults = targets.map(({ name, matches }) => {
	const matched = proposals.filter(({ content }) => matches(content))
	return {
		name,
		found: matched.length > 0,
		matches: matched.map(({ content, evidence, certainty, selected }) => ({
			content,
			certainty,
			selected,
			evidence: evidence.map(({ startLine, endLine, excerpt }) => ({
				startLine,
				endLine,
				excerpt
			}))
		}))
	}
})

const report = {
	warningCount: draft.warnings.length,
	warnings: draft.warnings,
	repairCount: repairLogs.length,
	repairs: repairLogs,
	proposalCount: proposals.length,
	selectedProposalCount: proposals.filter(({ selected }) => selected).length,
	targetResults
}

console.log('=== BLACKWATER EVIDENCE REPAIR BENCHMARK ===')
console.log(JSON.stringify(report, null, 2))
