import { basename } from 'node:path'
import { flatMap, map, succeed, type Effect } from 'effect/Effect'
import { pipe } from 'effect/Function'
import { parseDocument as parseYamlDocument, stringify } from 'yaml'
import { isDocumentType } from '../../document'
import { fail } from '../failure'
import type { Failure } from '../failure'
import { parseSessionBody, serializeSessionBody } from './session'
import {
	eventForms,
	type EventForm,
	type ParsedVaultDocument,
	type VaultFrontmatter
} from './types'

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

const updateYamlFrontmatter = (
	source: string,
	update: (document: ReturnType<typeof parseYamlDocument>) => void
): Effect<string, Failure<'vault', 'parseDocument'>> => {
	const document = parseYamlDocument(source, { keepSourceTokens: true })
	const error = document.errors[0]
	if (error) return fail('vault', 'parseDocument', error)
	update(document)
	return succeed(document.toString({ lineWidth: 0 }).trimEnd())
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
		flatMap((record) => {
			const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined
			const type =
				typeof record.type === 'string' && record.type.trim() ? record.type.trim() : undefined
			const aliases = Array.isArray(record.aliases)
				? record.aliases.filter(
						(alias): alias is string => typeof alias === 'string' && !!alias.trim()
					)
				: undefined
			const after = record.after
			const during = record.during
			const eventForm = record.event_form
			const ingestionId =
				type === 'session' && typeof record.ingestion_id === 'string' && record.ingestion_id.trim()
					? record.ingestion_id.trim()
					: undefined

			if (
				after !== undefined &&
				(!Array.isArray(after) ||
					after.some((documentId) => typeof documentId !== 'string' || !documentId.trim()))
			) {
				return fail('vault', 'parseDocument', {
					reason: 'invalidEventPredecessors',
					after
				})
			}
			if (
				during !== undefined &&
				(!Array.isArray(during) ||
					during.some((documentId) => typeof documentId !== 'string' || !documentId.trim()))
			) {
				return fail('vault', 'parseDocument', {
					reason: 'invalidEventPeriods',
					during
				})
			}
			if (
				eventForm !== undefined &&
				(typeof eventForm !== 'string' || !eventForms.includes(eventForm as EventForm))
			) {
				return fail('vault', 'parseDocument', {
					reason: 'invalidEventForm',
					eventForm
				})
			}

			if (type && !isDocumentType(type)) {
				return fail('vault', 'parseDocument', {
					reason: 'invalidDocumentType',
					type
				})
			}

			if (record.ingestion_id !== undefined && !ingestionId) {
				return fail('vault', 'parseDocument', {
					reason: 'invalidSessionIngestionId',
					ingestionId: record.ingestion_id
				})
			}

			const documentType = isDocumentType(type) ? type : undefined
			const predecessorIds = Array.isArray(after)
				? [...new Set(after.map((documentId: string) => documentId.trim()))]
				: undefined
			const periodIds = Array.isArray(during)
				? [...new Set(during.map((documentId: string) => documentId.trim()))]
				: undefined

			if (predecessorIds?.length && documentType && documentType !== 'event') {
				return fail('vault', 'parseDocument', {
					reason: 'eventPredecessorsOnNonEvent',
					type: documentType
				})
			}
			if (
				(periodIds?.length || eventForm !== undefined) &&
				documentType &&
				documentType !== 'event'
			) {
				return fail('vault', 'parseDocument', {
					reason: 'eventChronologyOnNonEvent',
					type: documentType
				})
			}

			return succeed({
				frontmatter: {
					id,
					type: documentType,
					aliases: aliases?.map((alias) => alias.trim()),
					after: predecessorIds,
					during: periodIds,
					eventForm:
						typeof eventForm === 'string' && eventForms.includes(eventForm as EventForm)
							? (eventForm as VaultFrontmatter['eventForm'])
							: undefined,
					ingestionId
				},
				content: source.slice(match[0].length).replace(/^\r?\n/, '')
			})
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
		map(({ frontmatter, content }): ParsedVaultDocument => {
			const session = frontmatter.type === 'session' ? parseSessionBody(content) : undefined
			const indexableContent = session?.recap ?? content

			return {
				id: frontmatter.id,
				path,
				title: deriveTitle(path, indexableContent),
				type: frontmatter.type,
				aliases: frontmatter.aliases,
				after: frontmatter.after ?? [],
				during: frontmatter.during ?? [],
				eventForm:
					frontmatter.type === 'event' ? (frontmatter.eventForm ?? 'occurrence') : undefined,
				summary: '',
				content: indexableContent,
				transcript: session?.transcript,
				ingestionId: frontmatter.ingestionId,
				links: extractWikiLinks(indexableContent)
			}
		})
	)

export const serializeVaultDocument = (
	frontmatter: VaultFrontmatter,
	content: string,
	transcript?: string
) => {
	const metadata = {
		...(frontmatter.id ? { id: frontmatter.id } : {}),
		...(frontmatter.type ? { type: frontmatter.type } : {}),
		...(frontmatter.aliases?.length ? { aliases: frontmatter.aliases } : {}),
		...(frontmatter.after?.length ? { after: frontmatter.after } : {}),
		...(frontmatter.during?.length ? { during: frontmatter.during } : {}),
		...(frontmatter.type === 'event' && frontmatter.eventForm
			? { event_form: frontmatter.eventForm }
			: {}),
		...(frontmatter.type === 'session' && frontmatter.ingestionId
			? { ingestion_id: frontmatter.ingestionId }
			: {})
	}
	const body = frontmatter.type === 'session' ? serializeSessionBody(content, transcript) : content

	return `---\n${stringify(metadata).trimEnd()}\n---\n\n${body.replace(/^\r?\n/, '')}`
}

export const updateDocumentFrontmatter = (
	source: string,
	frontmatter: Pick<Required<VaultFrontmatter>, 'id' | 'type'>
) => {
	const match = source.match(frontmatterPattern)

	if (!match) {
		return succeed(serializeVaultDocument(frontmatter, source))
	}

	return pipe(
		updateYamlFrontmatter(match[1], (document) => {
			document.set('id', frontmatter.id)
			document.set('type', frontmatter.type)
		}),
		map((metadata) => {
			const newline = source.includes('\r\n') ? '\r\n' : '\n'
			const trailingNewline = match[0].endsWith(newline) ? newline : ''
			return `---${newline}${metadata.replace(/\n/g, newline)}${newline}---${trailingNewline}${source.slice(match[0].length)}`
		})
	)
}

export const updateVaultDocumentSource = (
	source: string,
	frontmatter: Required<Pick<VaultFrontmatter, 'id' | 'type'>> &
		Pick<VaultFrontmatter, 'aliases' | 'after' | 'during' | 'eventForm' | 'ingestionId'>,
	content: string
) => {
	const match = source.match(frontmatterPattern)
	if (!match) return succeed(serializeVaultDocument(frontmatter, content))

	return pipe(
		parseFrontmatter(source),
		flatMap(({ frontmatter: existingFrontmatter, content: existingContent }) =>
			pipe(
				updateYamlFrontmatter(match[1], (document) => {
					document.set('id', frontmatter.id)
					document.set('type', frontmatter.type)
					if (frontmatter.aliases?.length) document.set('aliases', frontmatter.aliases)
					else document.delete('aliases')
					if (frontmatter.after?.length) document.set('after', frontmatter.after)
					else document.delete('after')
					if (frontmatter.during?.length) document.set('during', frontmatter.during)
					else document.delete('during')
					if (frontmatter.type === 'event' && frontmatter.eventForm)
						document.set('event_form', frontmatter.eventForm)
					else document.delete('event_form')
					if (frontmatter.type === 'session' && frontmatter.ingestionId)
						document.set('ingestion_id', frontmatter.ingestionId)
					else document.delete('ingestion_id')
				}),
				map((metadata) => {
					const newline = source.includes('\r\n') ? '\r\n' : '\n'
					const existingTranscript =
						existingFrontmatter.type === 'session'
							? parseSessionBody(existingContent).transcript
							: undefined
					const body =
						frontmatter.type === 'session'
							? serializeSessionBody(content, existingTranscript)
							: content
					const normalizedContent = body.replace(/^\r?\n/, '').replace(/\r?\n/g, newline)
					return `---${newline}${metadata.replace(/\n/g, newline)}${newline}---${newline}${newline}${normalizedContent}`
				})
			)
		)
	)
}
