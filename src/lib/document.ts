export const documentTypes = [
	'player',
	'npc',
	'location',
	'session',
	'item',
	'lore',
	'event'
] as const

export type DocumentType = (typeof documentTypes)[number]

export const isDocumentType = (value: unknown): value is DocumentType =>
	typeof value === 'string' && documentTypes.some((type) => type === value)
