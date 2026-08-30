import { runPromise, succeed } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { vaultOperations } from '../vault/operations'
import type { VaultDocument } from '../vault/types'
import { loreOperations } from './operations'

const campaignId = '17ea64a7-98e4-40de-ae5f-b8e35688e157'
const document: VaultDocument = {
	id: 'character-varek',
	path: 'NPCs/varek-the-smith.md',
	title: 'Varek the Smith',
	type: 'npc',
	after: [],
	content: '# Varek the Smith\n\nVarek repairs armor near the western gate.',
	links: ['Westgate']
}

type LoreVault = Pick<
	ReturnType<typeof vaultOperations>,
	'createDocument' | 'getDocument' | 'listDocuments'
>

describe('lore operations', () => {
	it('derives internal storage details when committing lore', async () => {
		const createDocument = vi.fn((_campaignId, _input) => succeed(document))
		const vault: LoreVault = {
			createDocument,
			getDocument: () => succeed(document),
			listDocuments: () => succeed([])
		}
		const lore = loreOperations({ vault })

		const created = await runPromise(
			lore.createLore(campaignId, {
				title: 'Varek the Smith',
				category: 'npc',
				content: 'Varek repairs armor near the western gate.'
			})
		)

		expect(createDocument).toHaveBeenCalledWith(campaignId, {
			path: 'NPCs/varek-the-smith.md',
			type: 'npc',
			content: '# Varek the Smith\n\nVarek repairs armor near the western gate.'
		})
		expect(created).toEqual({
			id: 'character-varek',
			title: 'Varek the Smith',
			category: 'npc',
			content: 'Varek repairs armor near the western gate.',
			links: ['Westgate']
		})
	})
})
