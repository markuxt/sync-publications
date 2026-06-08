/**
 * Parse OpenAlex work data into PendingPublication format.
 *
 * Addresses docs/code-review.md #14 — accepts the typed `OpenAlexWork`
 * directly (the cast from `unknown` happens once, at the API boundary,
 * in `openalex.ts`).
 */

import type { PendingPublication, OpenAlexWork } from '../types.js'
import { formatAuthorName, extractOrcidId } from '../utils/formatters.js'
import { reconstructAbstract } from '../utils/abstract.js'
import { doiToUrl } from '../utils/doi.js'
import { pickPdfUrl } from '../utils/pdf.js'

/**
 * Parse an OpenAlex work object into our internal publication format.
 * Returns null if the work is missing required fields (id / title / year).
 */
export function parseWork(work: OpenAlexWork): PendingPublication | null {
  // Extract OpenAlex ID (strip the URL prefix to get W123456789)
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
  const authorships = Array.isArray(work.authorships) ? work.authorships : []

  const authors = authorships
    .map(a => {
      const name = a.author?.display_name
      return name ? formatAuthorName(name) : null
    })
    .filter((n): n is string => n !== null)

  // Extract author ORCIDs (parallel to authors, includes nulls to preserve order)
  const authorsOrcid = authorships.map(a => extractOrcidId(a.author?.orcid))

  // Extract DOI — canonical https://doi.org/ form
  const doi = doiToUrl(work.doi)

  // Extract venue
  const venue = work.primary_location?.source?.display_name ?? null

  // Extract keywords
  const keywords = Array.isArray(work.keywords)
    ? work.keywords
        .map(k => k.display_name ?? '')
        .filter(Boolean)
    : []

  // Extract abstract (reconstructed from inverted index)
  const abstract = reconstructAbstract(work.abstract_inverted_index ?? null)

  // Extract best-effort open-access PDF URL
  const pdfUrl = pickPdfUrl(work)

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
    pdfUrl,
    abstractPage: null,
    abstractScreenshot: null,
    hidden: false
  }
}
