import { readFile } from 'node:fs/promises'
import OpenAI from 'openai'
import { runPromise, succeed } from 'effect/Effect'
import { assistant } from '../src/lib/server/assistant'
import { openAiProvider } from '../src/lib/server/ai/providers/openai'
import { context } from '../src/lib/server/context'
import type { ContextSource } from '../src/lib/server/context/types'
import { sessionIngestion } from '../src/lib/server/ingestion'
import type { SessionIngestionDraft } from '../src/lib/server/ingestion/types'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

const provider = openAiProvider(new OpenAI({ apiKey }))
const campaignId = 'embercourt-ad-hoc'

// ---------------------------------------------------------------------------
// 1. Fresh live ingestion test. No benchmark scoring: print what the real
//    ingestion pipeline actually proposed so it can be reviewed manually.
// ---------------------------------------------------------------------------

const transcript = await readFile('scripts/fixtures/embercourt-ad-hoc.txt', 'utf8')
let savedDraft: SessionIngestionDraft | undefined

const ingestion = sessionIngestion({
	ai: {
		analysisModel: provider.models.sessionAnalysis,
		analyzeSessionChunk: provider.analyzeSessionChunk,
		validateSessionClaims: provider.validateSessionClaims,
		repairSessionClaimEvidence: provider.repairSessionClaimEvidence,
		resolveSessionEntities: provider.resolveSessionEntities
	},
	storage: {
		write: (draft) => {
			savedDraft = draft
			return succeed(undefined)
		},
		read: () => succeed(savedDraft!),
		readTranscript: () => succeed(transcript)
	},
	vault: {
		getDocuments: () => succeed([]),
		createDocument: () => succeed(null as never),
		updateDocument: () => succeed(null as never)
	}
})

const draft = await runPromise(
	ingestion.analyze({
		campaignId,
		title: 'Embercourt: The Broken Treaty',
		transcript
	})
)

console.log('=== LIVE INGESTION ===')
console.log(
	JSON.stringify(
		{
			warningCount: draft.warnings.length,
			warnings: draft.warnings,
			proposals: draft.proposals
				.filter(({ documentType }) => documentType !== 'session')
				.map((proposal) => ({
					title: proposal.title,
					documentType: proposal.documentType,
					operation: proposal.operation,
					certainty: proposal.certainty,
					selected: proposal.selected,
					content: proposal.content,
					references: proposal.references,
					evidence: proposal.evidence.map(({ startLine, endLine, excerpt }) => ({
						startLine,
						endLine,
						excerpt
					}))
				}))
		},
		null,
		2
	)
)

// ---------------------------------------------------------------------------
// 2. One-off retrieval stress test. The core corpus is surrounded by 120
//    intentionally similar documents. Context is capped at 700 estimated
//    tokens so the engine has to choose instead of simply returning the vault.
// ---------------------------------------------------------------------------

type DocType = ContextSource['fragment']['documentType']
type CorpusDoc = {
	id: string
	title: string
	type: DocType
	content: string
	aliases?: string[]
	links?: string[]
	relationships?: { targetId: string; relationship: string }[]
}

const core: CorpusDoc[] = [
	{
		id: 'cael',
		title: 'Cael Ardin',
		type: 'npc',
		content:
			'Envoy Cael Ardin was poisoned last night but survived. Testing found nightshade in his replacement cup and none in the wine bottle or his first cup. Cael cannot identify the palace page who brought the replacement cup. No poison culprit has been identified.',
		links: ['poisoning', 'nightshade-cup', 'envoy-treaty']
	},
	{
		id: 'ysra',
		title: 'Ysra Pell',
		type: 'npc',
		content:
			'Court physician Ysra Pell confirmed nightshade in Cael Ardin’s replacement cup. The wine bottle and first cup tested clean. Her evidence establishes the delivery method but not who poisoned Cael.',
		links: ['cael', 'nightshade-cup', 'poisoning']
	},
	{
		id: 'orin',
		title: 'Orin Voss',
		type: 'npc',
		content:
			'Orin Voss has been chancellor for five years. Selene Marr claims he wants the treaty to fail. A note connected to Jessa’s page swap is signed only “O”; nothing establishes that O is Orin Voss.',
		links: ['o-note', 'selene', 'orin-chancellor']
	},
	{
		id: 'selene',
		title: 'Selene Marr',
		type: 'npc',
		content:
			'Lady Selene Marr denies touching Cael’s cup and claims Orin Voss wants to blame House Marr. Those are Selene’s statements, not independently established facts. No evidence establishes Selene’s involvement in either the treaty alteration or poisoning.',
		links: ['orin', 'forged-marr-signet']
	},
	{
		id: 'hal-marr',
		title: 'Brother Hal Marr',
		type: 'npc',
		content:
			'Brother Hal Marr is a priest of the Lantern Order who helps maintain treaty records. “Brother” is a religious title. No family relationship between Hal Marr and Selene Marr is known; Marr is a common river surname in Embercourt.',
		links: ['archive', 'selene']
	},
	{
		id: 'rowan',
		title: 'Captain Rowan Dace',
		type: 'npc',
		content:
			'Captain Rowan Dace secured Cael’s chamber. Nera initially assumed a red-cloaked figure leaving the archive was Rowan, but she never saw the figure’s face. Two gate sergeants independently corroborate Rowan’s alibi at the north gate around midnight.',
		links: ['nera', 'north-gate'],
		relationships: [{ targetId: 'north-gate', relationship: 'alibi at' }]
	},
	{
		id: 'nera',
		title: 'Nera',
		type: 'npc',
		content:
			'Nera saw someone of Rowan Dace’s height wearing a red officer’s cloak leave the archive after midnight. She did not see the person’s face and later clarified that she had only assumed it was Rowan. Rowan’s alibi was subsequently corroborated.',
		links: ['rowan', 'archive', 'north-gate']
	},
	{
		id: 'jessa',
		title: 'Jessa Quill',
		type: 'npc',
		content:
			'The party directly caught Jessa Quill wearing a white fox mask. Jessa possessed the original seventh treaty leaf and counterfeit marks for both the council and House Marr. She says she swapped the page for “someone on the council” and denies poisoning Cael; both statements remain claims.',
		links: ['original-leaf', 'counterfeit-council-stamp', 'forged-marr-signet', 'o-note', 'page-swap', 'poisoning']
	},
	{
		id: 'white-fox',
		title: 'White Fox',
		type: 'lore',
		content:
			'Lantern Market gossip claimed the masked courier called the White Fox worked for Elian Voss. The party later directly saw Jessa Quill using a white fox mask, but this does not establish that every historical White Fox report referred to Jessa or that Elian employed her.',
		links: ['jessa', 'elian']
	},
	{
		id: 'elian',
		title: 'Elian Voss',
		type: 'npc',
		content:
			'Elian Voss is Orin Voss’s nephew. Gossip says the White Fox works for Elian, but no evidence currently establishes that connection.',
		links: ['orin', 'white-fox']
	},
	{
		id: 'envoy-treaty',
		title: 'Cael Ardin’s envoy treaty copy',
		type: 'item',
		content:
			'Cael’s envoy treaty copy was altered: its seventh leaf grants Black Quay customs to House Marr, while the public archive copy leaves customs under the city council. The seventh leaf is fresher than the surrounding pages and was likely replaced within the last two days.',
		links: ['original-leaf', 'black-quay', 'page-swap']
	},
	{
		id: 'original-leaf',
		title: 'Original seventh treaty leaf',
		type: 'item',
		content:
			'Jessa Quill possessed a loose treaty leaf whose paper, ruling and ink match the removed seventh leaf. Its wording leaves Black Quay customs under the city council. The evidence strongly supports that it is the original leaf removed from Cael’s envoy copy. The party now possesses it.',
		links: ['jessa', 'envoy-treaty', 'black-quay']
	},
	{
		id: 'counterfeit-council-stamp',
		title: 'Counterfeit council seal stamp',
		type: 'item',
		content:
			'An iron seal stamp found in Jessa’s satchel is counterfeit. It makes a close but imperfect copy of the council seal and is not the official council seal press. The party possesses the counterfeit stamp.',
		links: ['jessa', 'seal-press']
	},
	{
		id: 'forged-marr-signet',
		title: 'Forged House Marr signet',
		type: 'item',
		content:
			'A silver House Marr signet found in Jessa’s satchel is a forgery, distinguished by a reversed river reed. It appears designed to imitate House Marr’s mark and does not by itself implicate Selene Marr. The party possesses it.',
		links: ['jessa', 'selene']
	},
	{
		id: 'wax-impression',
		title: 'Council seal wax impression',
		type: 'item',
		content:
			'The party found and took a shallow wax impression of the council seal from behind a loose panel in the seal press room. It is an impression, not the actual seal or seal press.',
		links: ['seal-press']
	},
	{
		id: 'customs-ledger',
		title: 'Customs expense ledger',
		type: 'item',
		content:
			'This week’s customs ledger contains “R.D. — forty crowns — courier expense.” The identity of R.D. is unknown, and the entry does not state what the courier carried. It does not establish a connection to Rowan Dace or the altered treaty.',
		links: ['rowan']
	},
	{
		id: 'o-note',
		title: 'Note signed O',
		type: 'item',
		content:
			'Found in Jessa’s hidden pocket: “Replace the seventh leaf before dawn. Burn the original. Payment after confirmation. — O.” The note supports that Jessa was instructed to replace the leaf, but the writer is identified only as O. Orin Voss is not established as the author.',
		links: ['jessa', 'page-swap', 'orin']
	},
	{
		id: 'nightshade-cup',
		title: 'Cael’s poisoned replacement cup',
		type: 'item',
		content:
			'Cael’s replacement cup tested positive for nightshade. His first cup and the wine bottle tested clean. The poisoned cup remains secured with Ysra Pell at Rose Hall; the party does not possess it.',
		links: ['cael', 'ysra', 'poisoning']
	},
	{
		id: 'black-quay',
		title: 'Black Quay',
		type: 'location',
		content:
			'Black Quay customs are the disputed subject of treaty clause seven. The public/original wording leaves them under the city council; the altered envoy leaf grants them to House Marr.',
		links: ['envoy-treaty', 'original-leaf']
	},
	{
		id: 'archive',
		title: 'Embercourt treaty archive',
		type: 'location',
		content:
			'The treaty archive stores the public treaty copy and received Cael’s envoy copy two nights ago for comparison. Nera later saw an unidentified red-cloaked figure leaving the archive after midnight.',
		links: ['envoy-treaty', 'nera', 'treaty-deposit']
	},
	{
		id: 'seal-press',
		title: 'Council seal press room',
		type: 'location',
		content:
			'Tovin Rusk and Chancellor Voss are authorized to use the council seal press, but maintenance staff can physically enter the press room for repairs. The party found a wax seal impression and an unsigned “seventh leaf before dawn” scrap there.',
		links: ['wax-impression', 'orin']
	},
	{
		id: 'north-gate',
		title: 'North Gate',
		type: 'location',
		content:
			'Two gate sergeants independently confirm Rowan Dace was at the North Gate from shortly before midnight until well after, corroborating his alibi.',
		links: ['rowan']
	},
	{
		id: 'poisoning',
		title: 'Poisoning of Cael Ardin',
		type: 'event',
		content:
			'Cael Ardin was poisoned last night with nightshade placed in his replacement cup. The wine bottle and first cup were clean. No culprit has been identified; Jessa Quill denies involvement, but that denial is only her claim.',
		links: ['cael', 'ysra', 'nightshade-cup', 'jessa']
	},
	{
		id: 'page-swap',
		title: 'Seventh treaty leaf replaced',
		type: 'event',
		content:
			'Within the last two days, the seventh leaf in Cael’s envoy treaty was replaced with altered wording favoring House Marr. Jessa possessed the original leaf and says she performed the swap for someone on the council. Her employer remains unidentified.',
		links: ['jessa', 'envoy-treaty', 'original-leaf', 'o-note']
	},
	{
		id: 'palace-fire',
		title: 'Palace Fire',
		type: 'event',
		content: 'The Palace Fire occurred twelve years ago.',
		links: []
	},
	{
		id: 'orin-chancellor',
		title: 'Orin Voss becomes chancellor',
		type: 'event',
		content: 'Orin Voss became chancellor five years ago.',
		links: ['orin']
	},
	{
		id: 'cael-arrival',
		title: 'Cael Ardin arrives in Embercourt',
		type: 'event',
		content: 'Cael Ardin arrived in Embercourt three days ago.',
		links: ['cael']
	},
	{
		id: 'treaty-deposit',
		title: 'Envoy treaty deposited for comparison',
		type: 'event',
		content: 'Cael’s envoy treaty copy was deposited at the treaty archive two nights ago and returned yesterday afternoon.',
		links: ['envoy-treaty', 'archive']
	}
]

const distractors: CorpusDoc[] = Array.from({ length: 120 }, (_, index) => {
	const bucket = index % 4
	if (bucket === 0) {
		return {
			id: `river-marr-${index}`,
			title: `Marr river resident ${index}`,
			type: 'npc',
			content: `A resident of Embercourt with the common river surname Marr. This person has no established family relationship to Selene Marr or Brother Hal Marr and has no known role in the current treaty investigation.`,
			links: []
		}
	}
	if (bucket === 1) {
		return {
			id: `seal-replica-${index}`,
			title: `Historic council seal replica ${index}`,
			type: 'item',
			content: `A harmless replica council seal kept for historical display. It is not the iron counterfeit stamp found with Jessa Quill, not the wax impression from the press room, and has no connection to clause seven of Cael Ardin’s treaty.`,
			links: []
		}
	}
	if (bucket === 2) {
		return {
			id: `old-treaty-${index}`,
			title: `Old Black Quay tariff dispute ${index}`,
			type: 'lore',
			content: `An unrelated historical dispute over Black Quay tariffs, council authority, treaty wording and customs fees. It predates Cael Ardin’s visit and does not involve Jessa Quill, House Marr, Orin Voss or the present seventh-leaf alteration.`,
			links: []
		}
	}
	return {
		id: `red-cloak-${index}`,
		title: `Red officer cloak record ${index}`,
		type: 'lore',
		content: `A routine record about red officer cloaks used by Embercourt guards. It does not identify the person Nera saw leaving the treaty archive and provides no evidence that Captain Rowan Dace was that figure.`,
		links: []
	}
})

const corpus = [...core, ...distractors]
const normalize = (value: string) =>
	(value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')

const sources: ContextSource[] = corpus.map((document) => ({
	fragment: {
		id: `${document.id}:0`,
		campaignId,
		documentId: document.id,
		title: document.title,
		documentType: document.type,
		content: document.content,
		position: 0,
		contentHash: `${document.id}-hash`
	},
	aliases: document.aliases ?? []
}))

const embeddings = await runPromise(
	provider.embedTexts({
		model: provider.models.embeddings,
		values: corpus.map((document) => `${document.title}\n${document.content}`)
	})
)
const embeddingByFragmentId = new Map(sources.map((source, index) => [source.fragment.id, embeddings[index] ?? []]))
const sourceByFragmentId = new Map(sources.map((source) => [source.fragment.id, source]))
const sourceByDocumentId = new Map(sources.map((source) => [source.fragment.documentId, source]))
const docById = new Map(corpus.map((document) => [document.id, document]))

const cosine = (a: number[], b: number[]) => {
	let dot = 0
	let aa = 0
	let bb = 0
	for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
		const left = a[index] ?? 0
		const right = b[index] ?? 0
		dot += left * right
		aa += left * left
		bb += right * right
	}
	return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

const linked = (seedDocumentIds: string[], direction: 'out' | 'in', relationships = false) => {
	const result: { seedDocumentId: string; documentId: string; relationship?: string }[] = []
	for (const seedDocumentId of seedDocumentIds) {
		if (direction === 'out') {
			const seed = docById.get(seedDocumentId)
			if (!seed) continue
			if (relationships) {
				for (const relation of seed.relationships ?? []) {
					result.push({ seedDocumentId, documentId: relation.targetId, relationship: relation.relationship })
				}
			} else {
				for (const documentId of seed.links ?? []) result.push({ seedDocumentId, documentId })
			}
			continue
		}
		for (const document of corpus) {
			if (relationships) {
				for (const relation of document.relationships ?? []) {
					if (relation.targetId === seedDocumentId) {
						result.push({ seedDocumentId, documentId: document.id, relationship: relation.relationship })
					}
				}
			} else if ((document.links ?? []).includes(seedDocumentId)) {
				result.push({ seedDocumentId, documentId: document.id })
			}
		}
	}
	return result
}

const db = {
	findDocumentIdsByNames: (_campaignId: string, normalizedNames: string[]) =>
		succeed(
			corpus
				.filter((document) =>
					[document.title, ...(document.aliases ?? [])]
						.map(normalize)
						.some((name) => normalizedNames.includes(name))
				)
				.map(({ id }) => id)
		),
	getFragmentsByIds: (_campaignId: string, fragmentIds: string[]) =>
		succeed(fragmentIds.flatMap((id) => (sourceByFragmentId.get(id) ? [sourceByFragmentId.get(id)!] : []))),
	getFragmentsForDocuments: (_campaignId: string, documentIds: string[]) =>
		succeed(documentIds.flatMap((id) => (sourceByDocumentId.get(id) ? [sourceByDocumentId.get(id)!] : []))),
	searchLexicalFragments: (_campaignId: string, terms: string[]) => {
		const matches = sources.flatMap((source) => {
			const document = docById.get(source.fragment.documentId)!
			const haystack = normalize(`${document.title} ${(document.aliases ?? []).join(' ')} ${document.content}`)
			const matched = terms.filter((term) => haystack.includes(normalize(term))).length
			return matched ? [{ source, score: matched * 3 }] : []
		})
		return succeed(matches.sort((a, b) => b.score - a.score).slice(0, 20))
	},
	searchVectors: (
		_campaignId: string,
		queryVector: number[],
		limit: number,
		minScore: number,
		_model: string
	) =>
		succeed(
			sources
				.map((source) => ({
					fragmentId: source.fragment.id,
					score: cosine(queryVector, embeddingByFragmentId.get(source.fragment.id) ?? [])
				}))
				.filter(({ score }) => score >= minScore)
				.sort((a, b) => b.score - a.score)
				.slice(0, limit)
		),
	getOutgoingLinksForDocuments: (_campaignId: string, seedDocumentIds: string[]) =>
		succeed(linked(seedDocumentIds, 'out').map(({ seedDocumentId, documentId }) => ({ seedDocumentId, documentId }))),
	getBacklinksForDocuments: (_campaignId: string, seedDocumentIds: string[]) =>
		succeed(linked(seedDocumentIds, 'in').map(({ seedDocumentId, documentId }) => ({ seedDocumentId, documentId }))),
	getOutgoingRelationshipLinksForDocuments: (_campaignId: string, seedDocumentIds: string[]) =>
		succeed(
			linked(seedDocumentIds, 'out', true).map(({ seedDocumentId, documentId, relationship }) => ({
				seedDocumentId,
				documentId,
				relationship: relationship!
			}))
		),
	getIncomingRelationshipLinksForDocuments: (_campaignId: string, seedDocumentIds: string[]) =>
		succeed(
			linked(seedDocumentIds, 'in', true).map(({ seedDocumentId, documentId, relationship }) => ({
				seedDocumentId,
				documentId,
				relationship: relationship!
			}))
		)
}

const timelineEvents = [
	{ documentId: 'palace-fire', title: 'Palace Fire' },
	{ documentId: 'orin-chancellor', title: 'Orin Voss becomes chancellor' },
	{ documentId: 'cael-arrival', title: 'Cael Ardin arrives in Embercourt' },
	{ documentId: 'treaty-deposit', title: 'Envoy treaty deposited for comparison' },
	{ documentId: 'poisoning', title: 'Poisoning of Cael Ardin' }
]
const timelineEdges = [
	{ beforeDocumentId: 'palace-fire', afterDocumentId: 'orin-chancellor' },
	{ beforeDocumentId: 'orin-chancellor', afterDocumentId: 'cael-arrival' },
	{ beforeDocumentId: 'cael-arrival', afterDocumentId: 'treaty-deposit' },
	{ beforeDocumentId: 'treaty-deposit', afterDocumentId: 'poisoning' }
]
const timeline = {
	getContext: (_campaignId: string, eventDocumentIds: string[]) =>
		succeed(
			eventDocumentIds.length
				? {
						events: timelineEvents,
						edges: timelineEdges,
						layers: timelineEvents.map(({ documentId }) => [documentId])
					}
				: { events: [], edges: [], layers: [] }
		)
}

const retrieval = context({
	ai: { embedTexts: provider.embedTexts, model: provider.models.embeddings },
	db,
	timeline,
	maxTokens: 700
})
const chat = assistant({
	ai: {
		generateAssistant: provider.generateAssistant,
		streamAssistant: provider.streamAssistant,
		model: provider.models.assistant
	},
	context: retrieval
})

const questions = [
	{
		id: 'poison-culprit',
		question: 'Who poisoned Cael Ardin, and what is actually established about how it happened?',
		history: []
	},
	{
		id: 'o-note',
		question: 'Does the note signed O prove that Orin Voss hired Jessa to alter the treaty?',
		history: []
	},
	{
		id: 'nera-rowan',
		question: 'How reliable is the claim that Rowan Dace left the archive after midnight?',
		history: []
	},
	{
		id: 'same-surname',
		question: 'Are Selene Marr and Brother Hal Marr siblings?',
		history: []
	},
	{
		id: 'counterfeit-items',
		question: 'Which council or House Marr seals/signets are counterfeit, and which of those items does the party actually possess?',
		history: []
	},
	{
		id: 'jessa-boundary',
		question: 'What is established about Jessa Quill’s role in the treaty alteration versus the poisoning?',
		history: []
	},
	{
		id: 'clause-seven',
		question: 'What happened to clause seven, what did the altered wording change, and who does that benefit?',
		history: []
	},
	{
		id: 'chronology',
		question: 'Put the Palace Fire, Orin becoming chancellor, Cael arriving, the treaty being deposited at the archive, and Cael’s poisoning in order.',
		history: []
	},
	{
		id: 'vague-red-cloak',
		question: 'The players vaguely remember somebody in a red cloak leaving the archive. What do we actually know about that?',
		history: []
	},
	{
		id: 'history-coreference',
		question: 'And what do we know about his whereabouts around midnight?',
		history: [
			{ role: 'user' as const, content: 'Was Rowan Dace implicated by the archive witness?' },
			{
				role: 'assistant' as const,
				content: 'Nera initially assumed the red-cloaked figure was Rowan, but she did not see the figure’s face.'
			}
		]
	}
]

console.log('=== 700-TOKEN RETRIEVAL STRESS TEST ===')
for (const item of questions) {
	const retrieved = await runPromise(
		retrieval.buildAssistantContext({ campaignId, message: item.question, history: item.history })
	)
	const response = await runPromise(chat.chat(campaignId, item.question, item.history))
	console.log(
		JSON.stringify(
			{
				id: item.id,
				question: item.question,
				estimatedTokens: retrieved.estimatedTokens,
				retrieved: retrieved.items.map(({ fragment, score, reasons }) => ({
					documentId: fragment.documentId,
					title: fragment.title,
					score,
					reasons
				})),
				answer: response.message,
				sources: response.sources.map(({ id, title }) => ({ id, title }))
			},
			null,
			2
		)
	)
}