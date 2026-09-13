import { readFile } from 'node:fs/promises'
import OpenAI from 'openai'
import { runPromise, succeed } from 'effect/Effect'
import { openAiProvider } from '../src/lib/server/ai/providers/openai'
import { sessionIngestionOperations } from '../src/lib/server/ingestion/operations'
import { filesystemIngestionStorage } from '../src/lib/server/ingestion/storage'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

const transcript = await readFile('scripts/fixtures/blackwater-benchmark.txt', 'utf8')
const provider = openAiProvider(new OpenAI({ apiKey }))

const attributionInstruction =
	'Preserve epistemic attribution in every extracted claim. If information is presented as dialogue, testimony, belief, rumor, legend, hearsay, or a written source, keep that source in the normalized claim content. Never rewrite "Ilyra says X" as "X", "Nell believes or reports X" as "X", "a letter states X" as "X", or "a legend says X" as "X". Only state X directly as an objective world fact when the transcript itself establishes X authoritatively. The certainty field describes how directly the full attributed claim is supported by the evidence; explicit does not mean that an embedded proposition is objectively true.'

const operations = sessionIngestionOperations({
	ai: {
		analysisModel: provider.models.sessionAnalysis,
		analyzeSessionChunk: (input) =>
			provider.analyzeSessionChunk({
				...input,
				system: `${input.system}\n\n${attributionInstruction}`
			}),
		validateSessionClaims: provider.validateSessionClaims,
		resolveSessionEntities: provider.resolveSessionEntities
	},
	storage: filesystemIngestionStorage('/tmp/loremaster-blackwater-hard-benchmark'),
	vault: {
		getDocuments: () => succeed([]),
		createDocument: () => succeed(null as never),
		updateDocument: () => succeed(null as never)
	}
})

const draft = await runPromise(
	operations.analyze({
		campaignId: 'blackwater-hard-benchmark',
		title: 'The Bell Beneath Blackwater',
		transcript
	})
)

const proposals = draft.proposals.filter(({ documentType }) => documentType !== 'session')
const uniqueClaims = [
	...new Map(
		proposals.flatMap((proposal) =>
			proposal.claimIds.map((claimId) => [
				claimId,
				{
					claimId,
					content: proposal.content,
					certainty: proposal.certainty,
					selected: proposal.selected,
					references: proposal.references,
					evidence: proposal.evidence.map(({ startLine, endLine, excerpt }) => ({
						startLine,
						endLine,
						excerpt
					}))
				}
			])
		)
	).values()
]

const questions = [
	'If the party confronts Mara, what can they safely accuse her of based on evidence, and what would still only be suspicion or hearsay?',
	'What does each major character actually know about the Lower Gate, as opposed to what the campaign establishes as true?',
	"Reconstruct the most likely chronology involving the Blackwater flood, Seraphine's death, Elias's final letter, the sealing of the Lower Gate, and the present day. Mark exact dates, relative dates, and inferences separately.",
	'What evidence suggests the bells were designed for communication, and what evidence—if any—shows that ringing them opens the Lower Gate?',
	'What are all the independently supported connections between Mara and the events beneath Greyhaven?',
	"Are Captain Harl's key and the black iron key from the lockbox the same key? What does the evidence actually allow us to conclude?",
	"What do we know about Seraphine Vey, and which parts come from physical evidence, written records, and Ilyra's testimony respectively?",
	'Who in the campaign has a family relationship to whom? Give the relationship and the source that establishes it.',
	'What unresolved mysteries are currently supported by evidence, rather than merely being interesting speculation?',
	'What changed during this session that should affect the current state of the campaign going forward?',
	'The party returns to Greyhaven six months later. Which facts from this session would still be safe to treat as persistent world state, and which would need to be re-verified?',
	'Give me the strongest case that Elias and Edric were involved with something beneath Greyhaven, then give me the strongest reasons not to overstate what we know.',
	'Why did Edric want to awaken the thing beneath Greyhaven?',
	'The players vaguely remember that somebody connected to Mara had something to do with resurrection or bringing back the drowned. What were they remembering, and how reliable is that information?'
]

const knowledge = uniqueClaims
	.map(
		(claim, index) =>
			`CLAIM C${index + 1} [${claim.certainty}]\n${claim.content}\nReferences: ${claim.references.map(({ label }) => label).join(', ') || 'none'}\nEvidence: ${claim.evidence.map(({ startLine, endLine }) => `${startLine}-${endLine}`).join(', ')}`
	)
	.join('\n\n')

const answers = await runPromise(
	provider.generateText({
		model: provider.models.assistant,
		system:
			'You are evaluating a trustworthy campaign-memory system. Answer only from the supplied validated claims. Preserve attribution: a character claim, belief, legend, written assertion, or inference is not automatically objective truth. Do not fill missing information from plausibility. Reject false premises explicitly. Distinguish fact, attributed claim, inference, uncertainty, and unknown whenever relevant. For every substantive conclusion, cite the supporting claim IDs in square brackets such as [C12]. Answer all fourteen numbered questions.',
		prompt: `## Validated ingestion claims\n\n${knowledge}\n\n## Hard questions\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`
	})
)

const report = {
	warningCount: draft.warnings.length,
	warnings: draft.warnings,
	proposalCount: proposals.length,
	selectedProposalCount: proposals.filter(({ selected }) => selected).length,
	claimCount: uniqueClaims.length,
	claims: uniqueClaims,
	questions,
	answers
}

console.log('=== BLACKWATER HARD-QUESTION BENCHMARK REPORT ===')
console.log(JSON.stringify(report, null, 2))
