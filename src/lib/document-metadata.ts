import type { DocumentType } from './document.js'

export const documentTypeMetadata = {
	player: { label: 'Players', icon: 'lucide:users' },
	npc: { label: 'NPCs', icon: 'lucide:user-round' },
	location: { label: 'Locations', icon: 'lucide:map-pin' },
	session: { label: 'Sessions', icon: 'lucide:calendar-days' },
	item: { label: 'Items', icon: 'lucide:package' },
	lore: { label: 'Lore', icon: 'lucide:book-open' },
	event: { label: 'Events', icon: 'lucide:milestone' }
} satisfies Record<DocumentType, { label: string; icon: string }>
