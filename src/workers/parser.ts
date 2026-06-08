/**
 * Parse OpenAlex work data into PendingPublication format
 */

import type { PendingPublication, OpenAlexWork } from '../types.js'
import { formatAuthorName, extractOrcidId } from '../utils/formatters.js'
import { reconstructAbstract } from '../utils/abstract.js'

/**
 * Parse OpenAlex work object into our publication format
 */
export function parseWork(work: OpenAlexWork | Record<string, unknown>): PendingPublication | null {
  // Extract OpenAlex ID
  const rawId = typeof work.id === 'string'
    ? work.id.replace('https://openalex.org/', '')
    : null

  if (!rawId) return null

  // Extract title
  const title = typeof work.title === 'string' ? work.title.trim() : null
  if (!title) return null

  // Extract year
  const year = typeof work.publication_year === 'number' ? work.publication_year : null
  if (!year) return null

  // Extract authors
  const authorships = Array.isArray(work.authorships)
    ? work.authorships as Record<string, unknown>[]
    : []

  const authors = authorships
    .map(a => {
      const author = a.author as Record<string, unknown> | undefined
      return author?.display_name ? formatAuthorName(String(author.display_name)) : null
    })
    .filter((n): n is string => n !== null)

  // Extract author ORCIDs
  const authorsOrcid = authorships.map(a => {
    const author = a.author as Record<string, unknown> | undefined
    return extractOrcidId(author?.orcid ? String(author.orcid) : null)
  })

  // Extract DOI
  const doiRaw = typeof work.doi === 'string' ? work.doi : null
  const doi = doiRaw
    ? (doiRaw.startsWith('http') ? doiRaw : `https://doi.org/${doiRaw}`)
    : null

  // Extract venue
  const primaryLocation = work.primary_location as Record<string, unknown> | undefined
  const source = primaryLocation?.source as Record<string, unknown> | undefined
  const venue = source?.display_name ? String(source.display_name) : null

  // Extract keywords
  const keywordsRaw = Array.isArray(work.keywords)
    ? work.keywords as Record<string, unknown>[]
    : []

  const keywords = keywordsRaw
    .map(k => String(k.display_name ?? ''))
    .filter(Boolean)

  // Extract abstract
  const abstract = reconstructAbstract(
    work.abstract_inverted_index as Record<string, number[]> | null
  )

  return {
    openalexId: rawId,
    title,
    authors,
    authorsOrcid,
    year,
    doi,
    venue,
    keywords,
    abstract,
    hidden: false
  }
}
