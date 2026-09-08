export const revisionOperations = ['create', 'update', 'delete', 'restore', 'import'] as const
export const revisionSources = ['manual', 'assistant', 'ingestion', 'restore', 'import'] as const

export type RevisionOperation = (typeof revisionOperations)[number]
export type RevisionSource = (typeof revisionSources)[number]

export type VaultRevision = {
	schemaVersion: 1
	revisionId: string
	previousRevisionId: string | null
	campaignId: string
	documentId: string
	path: string
	operation: RevisionOperation
	source: RevisionSource
	relatedSessionId?: string
	ingestionId?: string
	createdAt: string
	beforeHash: string | null
	afterHash: string | null
	snapshot: string | null
	changeSummary?: string
}

export type VaultRevisionMetadata = Omit<VaultRevision, 'snapshot'> & {
	hasSnapshot: boolean
}

export type RevisionHead = {
	campaignId: string
	documentId: string
	revisionId: string
	path: string
	sourceHash: string | null
}

export type RevisionDiffLine = {
	type: 'context' | 'added' | 'removed'
	line: string
}

export type RevisionDiffHunk = {
	oldStart: number
	newStart: number
	lines: RevisionDiffLine[]
}

export type RevisionDiff = {
	fromRevisionId: string | null
	toRevisionId: string
	hunks: RevisionDiffHunk[]
	truncated: boolean
	omittedLineCount: number
}
