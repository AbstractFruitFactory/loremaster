export type TimelineEdge = {
	beforeDocumentId: string
	afterDocumentId: string
}

export type TimelineContainment = {
	eventDocumentId: string
	periodDocumentId: string
}

export type TimelineEvent = {
	documentId: string
	title: string
}

export type TimelineRelation = 'before' | 'after' | 'unknown' | 'same'

export type TimelineContext = {
	scope: 'campaign' | 'neighborhood'
	events: TimelineEvent[]
	edges: TimelineEdge[]
	containments: TimelineContainment[]
}
