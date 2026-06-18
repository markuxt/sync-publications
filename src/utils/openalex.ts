/**
 * OpenAlex API utilities.
 *
 * Addresses docs/code-review.md:
 *   #7  — uses fetchWithRetry for timeout + backoff retry on 429/5xx.
 *   #10 — keeps encodeURIComponent on filter values (verified to work).
 *   #14 — getWorksForAuthor returns OpenAlexWork[] (typed, not unknown[]).
 */

import type { OpenAlexResponse, OpenAlexWork } from '../types'
import { fetchWithRetry } from './http'

const OPENALEX_BASE = 'https://api.openalex.org'

/**
 * Field sets for the works endpoint.
 *
 * WORK_FIELDS is the full set needed to build a PendingPublication.
 * WORK_LOOKUP_FIELDS is a focused set for single-work lookups (backfill):
 * just the ID plus what's needed for the similarity guard and author ORCIDs.
 */
const WORK_FIELDS = 'id,title,authorships,publication_year,doi,primary_location,keywords,abstract_inverted_index,open_access,best_oa_location'
const WORK_LOOKUP_FIELDS = 'id,title,authorships,publication_year,doi'

/**
 * Fetch from OpenAlex API with mailto + User-Agent (polite pool).
 * Retries automatically on transient failures.
 *
 * When `apiKey` is provided it is appended as `api_key=…`, switching requests
 * to OpenAlex's premium pool (higher rate limits). Without it the free polite
 * pool (mailto) is used.
 */
export async function oaFetch(
  path: string,
  contactEmail: string,
  apiKey?: string
): Promise<unknown> {
  const sep = path.includes('?') ? '&' : '?'
  let url = `${OPENALEX_BASE}${path}${sep}mailto=${encodeURIComponent(contactEmail)}`
  if (apiKey) url += `&api_key=${encodeURIComponent(apiKey)}`

  const res = await fetchWithRetry(url, {
    headers: {
      'User-Agent': `markuxt-sync-publications/1.0 (mailto:${contactEmail})`
    },
    timeoutMs: 30_000,
    retries: 3
  })

  if (!res.ok) {
    throw new Error(`OpenAlex ${res.status}: ${url}`)
  }

  return res.json()
}

/**
 * Get OpenAlex institution ID from a ROR ID.
 */
export async function getInstitutionId(rorId: string, contactEmail: string, apiKey?: string): Promise<string> {
  const data = await oaFetch(
    `/institutions?filter=ror:${encodeURIComponent(rorId)}&select=id`,
    contactEmail,
    apiKey
  ) as OpenAlexResponse<{ id: string }>

  if (!data.results?.length) {
    throw new Error(`Institution not found for ROR: ${rorId}`)
  }

  return data.results[0].id
}

/**
 * Get OpenAlex author ID from an ORCID.
 */
export async function getAuthorId(orcid: string, contactEmail: string, apiKey?: string): Promise<string | null> {
  const data = await oaFetch(
    `/authors?filter=orcid:${encodeURIComponent(orcid)}&select=id`,
    contactEmail,
    apiKey
  ) as OpenAlexResponse<{ id: string }>

  return data.results?.[0]?.id ?? null
}

/**
 * Get all works for an author affiliated with a specific institution.
 * Pages through OpenAlex's cursor pagination until exhausted.
 */
export async function getWorksForAuthor(
  authorId: string,
  institutionId: string,
  contactEmail: string,
  apiKey?: string
): Promise<OpenAlexWork[]> {
  const works: OpenAlexWork[] = []
  let cursor = '*'

  while (true) {
    const data = await oaFetch(
      `/works?filter=author.id:${encodeURIComponent(authorId)},institution.id:${encodeURIComponent(institutionId)}&per_page=200&cursor=${encodeURIComponent(cursor)}&select=${WORK_FIELDS}`,
      contactEmail,
      apiKey
    ) as OpenAlexResponse<OpenAlexWork> & { meta: { next_cursor: string | null } }

    works.push(...(data.results ?? []))

    if (!data.meta?.next_cursor) break
    cursor = data.meta.next_cursor
  }

  return works
}

/**
 * Look up a single work by its OpenAlex ID (W… form, with or without leading W).
 * Returns null if not found.
 */
export async function getWorkByOpenalexId(id: string, contactEmail: string, apiKey?: string): Promise<OpenAlexWork | null> {
  const digits = id.replace(/^W/, '').trim()
  if (!digits) return null
  const data = await oaFetch(
    `/works?filter=openalex:${encodeURIComponent(`W${digits}`)}&per_page=1&select=${WORK_LOOKUP_FIELDS}`,
    contactEmail,
    apiKey
  ) as OpenAlexResponse<OpenAlexWork>
  return data.results?.[0] ?? null
}

/**
 * Look up a single work by its bare DOI (e.g. "10.3390/polymers14102019").
 * Returns null if not found.
 */
export async function getWorkByDoi(bareDoi: string, contactEmail: string, apiKey?: string): Promise<OpenAlexWork | null> {
  if (!bareDoi) return null
  const data = await oaFetch(
    `/works?filter=doi:${encodeURIComponent(bareDoi)}&per_page=1&select=${WORK_LOOKUP_FIELDS}`,
    contactEmail,
    apiKey
  ) as OpenAlexResponse<OpenAlexWork>
  return data.results?.[0] ?? null
}

/**
 * Best-effort single-work lookup by title + publication year.
 *
 * Uses the modern `search=` parameter (`title.search` is deprecated). The
 * caller MUST verify the result is a genuine match — OpenAlex search is
 * fuzzy and the top hit may be a different work.
 */
export async function searchWorkByTitle(title: string, year: number, contactEmail: string, apiKey?: string): Promise<OpenAlexWork | null> {
  if (!title) return null
  const data = await oaFetch(
    `/works?search=${encodeURIComponent(title)}&filter=publication_year:${encodeURIComponent(String(year))}&per_page=1&select=${WORK_LOOKUP_FIELDS}`,
    contactEmail,
    apiKey
  ) as OpenAlexResponse<OpenAlexWork>
  return data.results?.[0] ?? null
}
