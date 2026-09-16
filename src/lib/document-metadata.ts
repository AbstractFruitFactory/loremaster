import type { DocumentType } from './document.js'
import eventIcon from './assets/event.svg'
import itemIcon from './assets/item.svg'
import locationIcon from './assets/location.svg'
import npcIcon from './assets/npc.svg'
import playerIcon from './assets/player.svg'
import sessionIcon from './assets/session.svg'
import worldbuildingIcon from './assets/worldbuilding.svg'

export const documentTypeMetadata = {
	player: { label: 'Players', icon: 'lucide:users', iconSrc: playerIcon },
	npc: { label: 'NPCs', icon: 'lucide:user-round', iconSrc: npcIcon },
	location: { label: 'Locations', icon: 'lucide:map-pin', iconSrc: locationIcon },
	session: { label: 'Sessions', icon: 'lucide:calendar-days', iconSrc: sessionIcon },
	item: { label: 'Items', icon: 'lucide:package', iconSrc: itemIcon },
	worldbuilding: { label: 'Worldbuilding', icon: 'lucide:book-open', iconSrc: worldbuildingIcon },
	event: { label: 'Events', icon: 'lucide:milestone', iconSrc: eventIcon }
} satisfies Record<DocumentType, { label: string; icon: string; iconSrc: string }>
