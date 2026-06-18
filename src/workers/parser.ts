/**
 * Parse OpenAlex work data into PendingPublication format.
 *
 * Addresses docs/code-review.md #14 — accepts the typed `OpenAlexWork`
 * directly (the cast from `unknown` happens once, at the API boundary,
 * in `openalex.ts`).
 */

import type { PendingPublication, OpenAlexWork } from '../types'
import { formatAuthorName, extractOrcidId } from '../utils/formatters'
import { reconstructAbstract } from '../utils/abstract'
import { doiToUrl } from '../utils/doi'
import { pickPdfUrls } from '../utils/pdf'

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

  // Extract authors + ORCIDs in parallel, deduping along the way.
  //
  // OpenAlex expands authorships per (author × institution), so the same
  // person shows up once per affiliation. Sometimes an author entry has
  // ORCID and a parallel entry for the same person does not — so we track
  // BOTH the ORCID and the lower-cased name as keys, and a new entry is a
  // duplicate if it matches either one. First occurrence wins so the
  // output order matches the input.
  //
  // Side effect: two genuinely-different "John Smith"s without ORCID will
  // collapse. That's acceptable because (a) OpenAlex normally disambiguates
  // with ORCID, and (b) showing the same name twice in the byline is
  // almost always wrong.
  const authorships = Array.isArray(work.authorships) ? work.authorships : []

  const authors: string[] = []
  const authorsOrcid: (string | null)[] = []
  const seen = new Set<string>()

  for (const a of authorships) {
    const displayName = a.author?.display_name
    if (!displayName) continue

    const name = formatAuthorName(displayName)
    const orcid = extractOrcidId(a.author?.orcid)
    const nameKey = name.toLowerCase()

    // Match if either key was seen before.
    if ((orcid && seen.has(orcid)) || seen.has(nameKey)) continue

    // Track both so future occurrences catch on whichever they expose.
    if (orcid) seen.add(orcid)
    seen.add(nameKey)

    authors.push(name)
    authorsOrcid.push(orcid)
  }

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

  // Extract best-effort open-access PDF URL candidates (tried in order)
  const pdfUrls = pickPdfUrls(work)
  const pdfUrl = pdfUrls[0] ?? null

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
    pdfUrls,
    abstractPage: null,
    abstractScreenshot: null,
    hidden: false
  }
}
