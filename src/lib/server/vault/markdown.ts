import { basename } from 'node:path'
import { map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { parseDocument as parseYamlDocument, stringify } from 'yaml'
import { fail } from '../failure'
import type { Failure } from '../failure'
import type { ParsedVaultDocument, VaultFrontmatter } from './types'

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const wikiLinkPattern = /(?<!!)\[\[([^\]\r\n]+)\]\]/g

const parseYamlRecord = (
	source: string
): Effect<Record<string, unknown>, Failure<'vault', 'parseDocument'>> => {
	const document = parseYamlDocument(source)
	const error = document.errors[0]

	if (error) {
		return fail('vault', 'parseDocument', error)
	}

	const value: unknown = document.toJS()
	return succeed(
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {}
	)
}

const parseFrontmatter = (
	source: string
): Effect<
	{ frontmatter: VaultFrontmatter; content: string },
	Failure<'vault', 'parseDocument'>
> => {
	const match = source.match(frontmatterPattern)

	if (!match) {
		return succeed({ frontmatter: {}, content: source })
	}

	return pipe(
		parseYamlRecord(match[1]),
		map((record) => {
			const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined
			const type =
				typeof record.type === 'string' && record.type.trim() ? record.type.trim() : undefined
			const aliases = Array.isArray(record.aliases)
				? record.aliases.filter(
						(alias): alias is string => typeof alias === 'string' && !!alias.trim()
					)
				: undefined

			return {
				frontmatter: {
					id,
					type,
					aliases: aliases?.map((alias) => alias.trim())
				},
				content: source.slice(match[0].length).replace(/^\r?\n/, '')
			}
		})
	)
}

const deriveTitle = (path: string, content: string) => {
	const heading = content.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim()
	return heading || basename(path, '.md')
}

export const extractWikiLinks = (content: string) => {
	const links = new Set<string>()

	for (const match of content.matchAll(wikiLinkPattern)) {
		const target = match[1].split('|', 1)[0].trim()

		if (target && !target.includes('#') && !target.includes('^')) {
			links.add(target)
		}
	}

	return [...links]
}

export const parseVaultDocument = (path: string, source: string) =>
	pipe(
		parseFrontmatter(source),
		map(({ frontmatter, content }): ParsedVaultDocument => ({
			id: frontmatter.id,
			path,
			title: deriveTitle(path, content),
			type: frontmatter.type,
			aliases: frontmatter.aliases,
			content,
			links: extractWikiLinks(content)
		}))
	)

export const serializeVaultDocument = (frontmatter: VaultFrontmatter, content: string) => {
	const metadata = {
		...(frontmatter.id ? { id: frontmatter.id } : {}),
		...(frontmatter.type ? { type: frontmatter.type } : {}),
		...(frontmatter.aliases?.length ? { aliases: frontmatter.aliases } : {})
	}

	return `---\n${stringify(metadata).trimEnd()}\n---\n\n${content.replace(/^\r?\n/, '')}`
}

export const addDocumentId = (source: string, id: string) => {
	const match = source.match(frontmatterPattern)

	if (!match) {
		return succeed(serializeVaultDocument({ id }, source))
	}

	return pipe(
		parseYamlRecord(match[1]),
		map(
			(metadata) =>
				`---\n${stringify({ ...metadata, id }).trimEnd()}\n---\n${source.slice(match[0].length)}`
		)
	)
}
