/**
 * OpenAlex API utilities
 */

import type { OpenAlexResponse } from '../types.js'

const OPENALEX_BASE = 'https://api.openalex.org'

/**
 * Fetch from OpenAlex API with mailto parameter
 */
export async function oaFetch(
  path: string,
  contactEmail: string
): Promise<unknown> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${OPENALEX_BASE}${path}${sep}mailto=${encodeURIComponent(contactEmail)}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': `markuxt-sync-publications/1.0 (mailto:${contactEmail})`
    }
  })

  if (!res.ok) {
    throw new Error(`OpenAlex ${res.status}: ${url}`)
  }

  return res.json()
}

/**
 * Get OpenAlex institution ID from ROR ID
 */
export async function getInstitutionId(rorId: string, contactEmail: string): Promise<string> {
  const data = await oaFetch(
    `/institutions?filter=ror:${encodeURIComponent(rorId)}&select=id`,
    contactEmail
  ) as OpenAlexResponse<{ id: string }>

  if (!data.results?.length) {
    throw new Error(`Institution not found for ROR: ${rorId}`)
  }

  return data.results[0].id
}

/**
 * Get OpenAlex author ID from ORCID
 */
export async function getAuthorId(orcid: string, contactEmail: string): Promise<string | null> {
  const data = await oaFetch(
    `/authors?filter=orcid:${encodeURIComponent(orcid)}&select=id`,
    contactEmail
  ) as OpenAlexResponse<{ id: string }>

  return data.results?.[0]?.id ?? null
}

/**
 * Get all works for an author at a specific institution
 */
export async function getWorksForAuthor(
  authorId: string,
  institutionId: string,
  contactEmail: string
): Promise<unknown[]> {
  const works: unknown[] = []
  let cursor = '*'

  const fields = 'id,title,authorships,publication_year,doi,primary_location,keywords,abstract_inverted_index'

  while (true) {
    const data = await oaFetch(
      `/works?filter=author.id:${encodeURIComponent(authorId)},institution.id:${encodeURIComponent(institutionId)}&per_page=200&cursor=${cursor}&select=${fields}`,
      contactEmail
    ) as OpenAlexResponse<unknown> & { meta: { next_cursor: string | null } }

    works.push(...data.results)

    if (!data.meta?.next_cursor) break
    cursor = data.meta.next_cursor
  }

  return works
}
