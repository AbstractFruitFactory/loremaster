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
const campaignId = 'cinderwake-generalization'

// ---------------------------------------------------------------------------
// Phase 1: novel ingestion generalization test
// ---------------------------------------------------------------------------

const transcript = await readFile('scripts/fixtures/cinderwake-generalization.txt', 'utf8')
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

const ingestionDraft = await runPromise(
	ingestion.analyze({
		campaignId,
		title: 'Cinderwake: The Blue Key',
		transcript
	})
)

const ingestionText = ingestionDraft.proposals
	.filter(({ documentType }) => documentType !== 'session')
	.map(({ content }) => content.toLocaleLowerCase())
	.join('\n')

const ingestionTargets = [
	{
		name: 'Sister Vale has no established family relationship to Tessa or Corin',
		terms: ['sister vale', 'related']
	},
	{
		name: 'Tessa says the blue-glass key is not for the Beacon and opens the Salt Archive lift',
		terms: ['blue', 'key', 'maintenance lift', 'salt archive']
	},
	{
		name: 'Orren claims he saw Tessa at the Old Beacon',
		terms: ['orren', 'tessa', 'old beacon']
	},
	{
		name: 'Blue-glass key and brass customs key are separate items',
		terms: ['blue-glass key', 'brass customs key']
	},
	{
		name: 'Tessa noticed suspicious bolt scoring before the sluice collapse',
		terms: ['retaining bolts', 'scoring']
	},
	{
		name: 'East Sluice bolts were deliberately weakened but culprit is unknown',
		terms: ['deliberately', 'weakened']
	},
	{
		name: 'C.V. payment identity is not established as Corin Vale',
		terms: ['c.v.', 'eighty crowns']
	},
	{
		name: 'Brass customs key demonstrably opens the records strongroom',
		terms: ['brass', 'key', 'strongroom']
	},
	{
		name: 'Corin Vale is Tessa Vale’s father',
		terms: ['corin vale', 'tessa vale', 'father']
	},
	{
		name: 'Tide Engine pressure rose before Founder’s Tide but cause remains undetermined',
		terms: ['tide engine', 'pressure', 'undetermined']
	},
	{
		name: 'Tessa explicitly warns not to assume Alda killed her',
		terms: ['do not assume', 'alda', 'killed']
	}
]

const ingestionTargetResults = ingestionTargets.map(({ name, terms }) => ({
	name,
	found: terms.every((term) => ingestionText.includes(term))
}))

// ---------------------------------------------------------------------------
// Phase 2: production retrieval + assistant reasoning over an unrelated corpus
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

const corpus: CorpusDoc[] = [
	{
		id: 'tessa',
		title: 'Tessa Vale',
		type: 'npc',
		content:
			'Tessa Vale is cartographer Corin Vale’s daughter. She vanished two years ago. Her note says the blue-glass key is not for the Old Beacon and opens the maintenance lift beneath the Salt Archive. Her final notebook entry says not to assume Alda Quinn killed her: Alda is hiding something about the sluice, but Tessa had no proof Alda meant her harm.',
		links: ['corin', 'blue-key', 'salt-archive', 'old-beacon', 'alda'],
		relationships: [{ targetId: 'corin', relationship: 'daughter of' }]
	},
	{
		id: 'corin',
		title: 'Corin Vale',
		type: 'npc',
		content:
			'Corin Vale is Cinderwake’s dockmaster and Tessa Vale’s father. He was dockmaster at the time of the Ashfall fire and remains dockmaster. No evidence establishes that the initials C.V. in the Red Ledger refer to Corin.',
		links: ['tessa', 'ashfall-fire', 'red-ledger'],
		relationships: [{ targetId: 'tessa', relationship: 'father of' }]
	},
	{
		id: 'sister-vale',
		title: 'Sister Vale',
		type: 'npc',
		content:
			'Sister Vale serves at the Chapel of Tides and knew Tessa from the relief kitchens. No family relationship between Sister Vale and Tessa Vale or Corin Vale is known; Vale is a common harbor surname.',
		links: ['chapel', 'tessa']
	},
	{
		id: 'orren',
		title: 'Orren Pike',
		type: 'npc',
		content:
			'Orren Pike is a ferryman. Orren claims he saw Tessa Vale at the Old Beacon on the night before she disappeared, arguing with an unidentified person in a gray coat. No other witness is known to corroborate Orren’s account.',
		links: ['tessa', 'old-beacon']
	},
	{
		id: 'alda',
		title: 'Alda Quinn',
		type: 'npc',
		content:
			'Alda Quinn is the harbor engineer overseeing the eastern works. Alda claimed the blue-glass key opened the Old Beacon service door and claimed the East Sluice failed because forty-year-old retaining bolts gave out. The blue key was later demonstrated to open the Salt Archive maintenance lift, and inspection showed several failed sluice bolts had clean tool cuts rather than corrosion.',
		links: ['blue-key', 'old-beacon', 'east-sluice', 'salt-archive'],
		relationships: [{ targetId: 'east-sluice', relationship: 'oversees' }]
	},
	{
		id: 'maelin',
		title: 'Brother Maelin Sorn',
		type: 'npc',
		content:
			'Brother Maelin Sorn keeps the Salt Archive. He reports that sailors have blamed the Tide Engine for Founder’s Tide for decades, but the surviving engineering record lists the flood’s cause as undetermined.',
		links: ['salt-archive', 'tide-engine', 'founders-tide']
	},
	{
		id: 'blue-key',
		title: 'Blue-glass key',
		type: 'item',
		aliases: ['blue key'],
		content:
			'Tessa’s note says the blue-glass key is not for the Old Beacon and opens the maintenance lift beneath the Salt Archive. The party later tested it: the key fit the blue-glass keyway and opened that maintenance lift.',
		links: ['tessa', 'salt-archive', 'old-beacon']
	},
	{
		id: 'brass-key',
		title: 'Brass customs key',
		type: 'item',
		aliases: ['brass key'],
		content:
			'The brass customs key is a different item from the blue-glass key. Maelin recognized it as a customs strongroom key, and the party later confirmed it opens the old records strongroom in the customs annex.',
		links: ['customs-strongroom', 'blue-key']
	},
	{
		id: 'red-ledger',
		title: 'Red Ledger',
		type: 'item',
		content:
			'The Red Ledger is an eleven-year-old customs record from the year of the Ashfall fire. It lists irregular payments by House Sorn using initials, including “C.V. — eighty crowns — ash disposal.” The ledger does not identify C.V., explain “ash disposal,” or say that the payment funded or caused the fire.',
		links: ['ashfall-fire', 'house-sorn']
	},
	{
		id: 'east-sluice',
		title: 'East Sluice',
		type: 'location',
		content:
			'The East Sluice collapsed three months ago. Tessa recorded fresh lateral scoring on gate-three retaining bolts one month before the collapse. Later inspection found parallel tool marks and clean cuts from the inside face: someone deliberately weakened the bolts. The culprit is unknown.',
		links: ['tessa', 'alda', 'sluice-collapse']
	},
	{
		id: 'old-beacon',
		title: 'Old Beacon',
		type: 'location',
		content:
			'Orren Pike claims he saw Tessa Vale at the Old Beacon the night before she disappeared. Alda Quinn claimed the blue-glass key belonged to the Beacon, but Tessa denied this and the key was later demonstrated to open the Salt Archive maintenance lift instead.',
		links: ['orren', 'tessa', 'alda', 'blue-key']
	},
	{
		id: 'salt-archive',
		title: 'Salt Archive',
		type: 'location',
		content:
			'The Salt Archive is kept by Brother Maelin Sorn. A concealed maintenance lift beneath the archive has a blue-glass keyway; the party confirmed Tessa’s blue-glass key opens it. The lower level contains Tide Engine engineering plans.',
		links: ['maelin', 'blue-key', 'tide-engine'],
		relationships: [{ targetId: 'maelin', relationship: 'kept by' }]
	},
	{
		id: 'customs-strongroom',
		title: 'Customs records strongroom',
		type: 'location',
		content:
			'The old customs records strongroom is in the customs annex. The party directly confirmed the brass customs key opens it. The Red Ledger was found inside.',
		links: ['brass-key', 'red-ledger']
	},
	{
		id: 'chapel',
		title: 'Chapel of Tides',
		type: 'location',
		content: 'The Chapel of Tides is where Sister Vale serves. Tessa left a sealed note there two years ago.',
		links: ['sister-vale', 'tessa']
	},
	{
		id: 'tide-engine',
		title: 'Tide Engine',
		type: 'lore',
		content:
			'Old sailors claim the Tide Engine caused Founder’s Tide. A surviving maintenance log records a sharp pressure rise shortly before the flood, but explicitly lists the flood’s cause as undetermined. The campaign has not established that the engine caused the disaster.',
		links: ['founders-tide', 'salt-archive']
	},
	{
		id: 'founders-tide',
		title: 'Founder’s Tide',
		type: 'event',
		content:
			'Founder’s Tide struck Cinderwake forty-two years ago. Sailors blame the Tide Engine, but the surviving engineering record does not establish causation.',
		links: ['tide-engine']
	},
	{
		id: 'ashfall-fire',
		title: 'Ashfall fire',
		type: 'event',
		content:
			'The Ashfall fire destroyed the old Ember Market eleven years ago. The Red Ledger is from the same year, but it does not say any listed payment funded or caused the fire.',
		links: ['red-ledger']
	},
	{
		id: 'tessa-disappearance',
		title: 'Tessa Vale disappears',
		type: 'event',
		content: 'Tessa Vale vanished two years ago. Orren Pike claims he saw her at the Old Beacon the night before she disappeared.',
		links: ['tessa', 'orren', 'old-beacon']
	},
	{
		id: 'sluice-collapse',
		title: 'East Sluice collapse',
		type: 'event',
		content:
			'The East Sluice collapsed three months ago. Evidence now shows retaining bolts had been deliberately weakened before the collapse, but no culprit is established.',
		links: ['east-sluice']
	},
	{
		id: 'house-sorn',
		title: 'House Sorn',
		type: 'lore',
		content:
			'House Sorn appears in the Red Ledger as making irregular payments eleven years ago. One recipient is recorded only as C.V.; the identity of C.V. is not established.',
		links: ['red-ledger']
	},
	// Distractors intentionally share vocabulary with the gold documents.
	{
		id: 'west-sluice',
		title: 'West Sluice',
		type: 'location',
		content: 'The West Sluice was rebuilt six years ago after storm erosion. Its retaining bolts were replaced during the rebuild.',
		links: []
	},
	{
		id: 'green-key',
		title: 'Green lighthouse key',
		type: 'item',
		content: 'A green-painted iron key opens a storage room in the new lighthouse. It has no known connection to Tessa Vale.',
		links: []
	},
	{
		id: 'ember-market',
		title: 'New Ember Market',
		type: 'location',
		content: 'The New Ember Market was built after the Ashfall fire and currently hosts the city’s weekly fish auction.',
		links: ['ashfall-fire']
	},
	{
		id: 'alden-quinn',
		title: 'Alden Quinn',
		type: 'npc',
		content: 'Alden Quinn is a chandlery owner with no established family relationship to Alda Quinn.',
		links: []
	},
	{
		id: 'gray-coat',
		title: 'Gray-coated stranger',
		type: 'npc',
		content: 'Orren says the person arguing with Tessa at the Old Beacon wore a gray coat. Orren could not see the stranger’s face.',
		links: ['orren', 'tessa', 'old-beacon']
	},
	{
		id: 'harbor-bell',
		title: 'Harbor warning bell',
		type: 'item',
		content: 'The harbor warning bell sounds during storm surges. It is unrelated to the Tide Engine maintenance system.',
		links: []
	},
	{
		id: 'founder-statue',
		title: 'Founder’s statue',
		type: 'location',
		content: 'The Founder’s statue commemorates Cinderwake’s first harbor master and was repaired after Founder’s Tide.',
		links: ['founders-tide']
	}
]

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

const corpusEmbeddingInputs = corpus.map(
	(document) => `${document.title}\n${(document.aliases ?? []).join(', ')}\n${document.content}`
)
const corpusEmbeddings = await runPromise(
	provider.embedTexts({ model: provider.models.embeddings, values: corpusEmbeddingInputs })
)
const embeddingByFragmentId = new Map(
	sources.map((source, index) => [source.fragment.id, corpusEmbeddings[index] ?? []])
)

const cosine = (a: number[], b: number[]) => {
	let dot = 0
	let aa = 0
	let bb = 0
	const length = Math.min(a.length, b.length)
	for (let index = 0; index < length; index += 1) {
		const left = a[index] ?? 0
		const right = b[index] ?? 0
		dot += left * right
		aa += left * left
		bb += right * right
	}
	return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

const sourceByFragmentId = new Map(sources.map((source) => [source.fragment.id, source]))
const sourceByDocumentId = new Map(sources.map((source) => [source.fragment.documentId, source]))
const docById = new Map(corpus.map((document) => [document.id, document]))

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
						result.push({
							seedDocumentId,
							documentId: document.id,
							relationship: relation.relationship
						})
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
	{ documentId: 'founders-tide', title: 'Founder’s Tide' },
	{ documentId: 'ashfall-fire', title: 'Ashfall fire' },
	{ documentId: 'tessa-disappearance', title: 'Tessa Vale disappears' },
	{ documentId: 'sluice-collapse', title: 'East Sluice collapse' }
]
const timelineEdges = [
	{ beforeDocumentId: 'founders-tide', afterDocumentId: 'ashfall-fire' },
	{ beforeDocumentId: 'ashfall-fire', afterDocumentId: 'tessa-disappearance' },
	{ beforeDocumentId: 'tessa-disappearance', afterDocumentId: 'sluice-collapse' }
]
const timeline = {
	getContext: (_campaignId: string, eventDocumentIds: string[]) =>
		succeed(
			eventDocumentIds.length
				? {
						events: timelineEvents,
						edges: timelineEdges,
						layers: [
							['founders-tide'],
							['ashfall-fire'],
							['tessa-disappearance'],
							['sluice-collapse']
						]
					}
				: { events: [], edges: [], layers: [] }
		)
}

const questions = [
	{
		id: 'false-premise',
		question: 'Did Corin Vale take a payment to start the Ashfall fire?',
		gold: ['corin', 'red-ledger', 'ashfall-fire']
	},
	{
		id: 'conflicting-key-claims',
		question: 'Where does the blue-glass key actually fit, and who said otherwise?',
		gold: ['blue-key', 'tessa', 'alda', 'salt-archive']
	},
	{
		id: 'witness-reliability',
		question: 'Who reported seeing Tessa immediately before she vanished, where, and how well is that corroborated?',
		gold: ['orren', 'tessa', 'old-beacon']
	},
	{
		id: 'same-surname',
		question: 'Are Sister Vale and Corin Vale related?',
		gold: ['sister-vale', 'corin']
	},
	{
		id: 'sabotage',
		question: 'What is the strongest evidence that the East Sluice collapse was sabotage, and do we know who did it?',
		gold: ['east-sluice', 'tessa', 'sluice-collapse']
	},
	{
		id: 'key-disambiguation',
		question: 'Which key opens the customs records strongroom: the blue key or the brass key?',
		gold: ['brass-key', 'blue-key', 'customs-strongroom']
	},
	{
		id: 'causation-boundary',
		question: 'Did the Tide Engine cause Founder’s Tide?',
		gold: ['tide-engine', 'founders-tide', 'maelin']
	},
	{
		id: 'chronology',
		question: 'Put Founder’s Tide, the Ashfall fire, Tessa’s disappearance, and the East Sluice collapse in order.',
		gold: ['founders-tide', 'ashfall-fire', 'tessa-disappearance', 'sluice-collapse']
	},
	{
		id: 'history-coreference',
		question: 'And what did she say about Alda?',
		history: [
			{ role: 'user' as const, content: 'Remind me what Tessa’s note said about the blue key.' },
			{
				role: 'assistant' as const,
				content: 'Tessa said the blue-glass key was not for the Old Beacon and opened the Salt Archive maintenance lift.'
			}
		],
		gold: ['tessa', 'alda']
	},
	{
		id: 'vague-memory',
		question: 'The players vaguely remember a Vale at the chapel. Who was that, and does the surname establish a family link to Tessa?',
		gold: ['sister-vale', 'tessa', 'chapel']
	}
]

const runRetrievalSuite = async (maxTokens: number, withAnswers: boolean) => {
	const retrieval = context({
		ai: { embedTexts: provider.embedTexts, model: provider.models.embeddings },
		db,
		timeline,
		maxTokens
	})
	const chat = assistant({
		ai: {
			generateAssistant: provider.generateAssistant,
			streamAssistant: provider.streamAssistant,
			model: provider.models.assistant
		},
		context: retrieval
	})

	const results = []
	for (const item of questions) {
		const history = item.history ?? []
		const retrieved = await runPromise(
			retrieval.buildAssistantContext({ campaignId, message: item.question, history })
		)
		const selectedIds = [...new Set(retrieved.items.map(({ fragment }) => fragment.documentId))]
		const foundGold = item.gold.filter((id) => selectedIds.includes(id))
		const response = withAnswers
			? await runPromise(chat.chat(campaignId, item.question, history))
			: undefined
		results.push({
			id: item.id,
			question: item.question,
			gold: item.gold,
			selectedIds,
			goldRecall: foundGold.length / item.gold.length,
			retrieved: retrieved.items.map(({ fragment, score, reasons }) => ({
				documentId: fragment.documentId,
				title: fragment.title,
				score,
				reasons
			})),
			answer: response?.message,
			sources: response?.sources.map(({ id, title }) => ({ id, title }))
		})
	}

	return {
		maxTokens,
		averageGoldRecall:
			results.reduce((sum, result) => sum + result.goldRecall, 0) / Math.max(1, results.length),
		perfectRecallQuestions: results.filter(({ goldRecall }) => goldRecall === 1).length,
		results
	}
}

const productionRetrieval = await runRetrievalSuite(12_000, true)
const stressRetrieval = await runRetrievalSuite(1_200, false)

const report = {
	ingestion: {
		warningCount: ingestionDraft.warnings.length,
		warnings: ingestionDraft.warnings,
		proposalCount: ingestionDraft.proposals.filter(({ documentType }) => documentType !== 'session').length,
		selectedProposalCount: ingestionDraft.proposals.filter(
			({ documentType, selected }) => documentType !== 'session' && selected
		).length,
		targetPasses: ingestionTargetResults.filter(({ found }) => found).length,
		targetTotal: ingestionTargetResults.length,
		targetResults: ingestionTargetResults
	},
	productionRetrieval,
	stressRetrieval
}

console.log('=== CINDERWAKE GENERALIZATION BENCHMARK ===')
console.log(JSON.stringify(report, null, 2))
