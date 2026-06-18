/**
 * Backfill missing `openalex_id` / `authors_orcid` in existing publication
 * files by looking the work up on OpenAlex.
 *
 * Lookup priority (first reliable hit wins):
 *   1. existing `openalex_id`          → filter=openalex:W…
 *   2. DOI                             → filter=doi:<bare>
 *   3. title + year search (fallback)  → search=<title>&filter=publication_year:<year>
 *      …guarded by title Jaccard ≥ 0.85 and author overlap ≥ 0.5, so an
 *      uncertain search hit never writes a wrong ID.
 *
 * Only the missing fields are written; every other frontmatter field and the
 * body are preserved verbatim (see updateFrontmatter in utils/yaml.ts).
 */

import { readFileSync, writeFileSync } from 'fs'
import type { ExistingPublication, OpenAlexWork, BackfillResult } from '../types'
import { getWorkByOpenalexId, getWorkByDoi, searchWorkByTitle } from '../utils/openalex'
import { parseYamlFrontmatter, updateFrontmatter } from '../utils/yaml'
import { normalizeDoi } from '../utils/doi'
import { formatAuthorName, extractOrcidId } from '../utils/formatters'
import { tokenize, jaccardSimilarity, authorOverlap } from '../utils/deduplication'

const TITLE_SIM_THRESHOLD = 0.85
const AUTHOR_OVERLAP_THRESHOLD = 0.5

/**
 * Build an `authors_orcid` list parallel to `existingAuthors`, matching each
 * author to an ORCID from the OpenAlex work by formatted name.
 *
 * Names are compared as lower-cased "Last, First" (the form stored in the
 * frontmatter and produced by formatAuthorName). Authors with no matching
 * OpenAlex entry get `null`.
 */
export function buildAuthorsOrcid(existingAuthors: string[], work: OpenAlexWork): (string | null)[] {
  // Map lowercased formatted name → ORCID from the work's authorships.
  // First occurrence wins (mirrors parseWork's dedup intent).
  const orcidByName = new Map<string, string | null>()
  for (const a of work.authorships ?? []) {
    const display = a.author?.display_name
    if (!display) continue
    const key = formatAuthorName(display).toLowerCase()
    if (!orcidByName.has(key)) {
      orcidByName.set(key, extractOrcidId(a.author?.orcid ?? null))
    }
  }

  return existingAuthors.map(name => orcidByName.get(name.toLowerCase()) ?? null)
}

/**
 * Derive both `authors` and `authors_orcid` from a work when a file has no
 * `authors` list at all. Mirrors parseWork's author-dedup logic.
 */
function deriveAuthorsFromWork(work: OpenAlexWork): { authors: string[]; authorsOrcid: (string | null)[] } {
  const authors: string[] = []
  const authorsOrcid: (string | null)[] = []
  const seen = new Set<string>()

  for (const a of work.authorships ?? []) {
    const display = a.author?.display_name
    if (!display) continue

    const name = formatAuthorName(display)
    const orcid = extractOrcidId(a.author?.orcid ?? null)
    const nameKey = name.toLowerCase()

    // Dedup on ORCID (preferred) or name (fallback), keeping first spelling.
    if ((orcid && seen.has(orcid)) || seen.has(nameKey)) continue
    if (orcid) seen.add(orcid)
    seen.add(nameKey)

    authors.push(name)
    authorsOrcid.push(orcid)
  }

  return { authors, authorsOrcid }
}

/**
 * Resolve the OpenAlex work for an existing publication following the lookup
 * priority. Returns null if nothing reliable was found.
 */
async function resolveWork(
  fm: Record<string, unknown>,
  contactEmail: string,
  apiKey?: string
): Promise<OpenAlexWork | null> {
  const storedId = typeof fm.openalex_id === 'string' ? fm.openalex_id.trim() : ''
  if (storedId) {
    const work = await getWorkByOpenalexId(storedId, contactEmail, apiKey)
    if (work) return work
  }

  const doi = normalizeDoi(typeof fm.doi === 'string' ? fm.doi : null)
  if (doi) {
    const work = await getWorkByDoi(doi, contactEmail, apiKey)
    if (work) return work
  }

  // Last resort: fuzzy title + year search, guarded against mismatches.
  const title = typeof fm.title === 'string' ? fm.title.trim() : ''
  const year = typeof fm.year === 'number'
    ? fm.year
    : (typeof fm.year === 'string' ? parseInt(fm.year, 10) : NaN)
  if (!title || !Number.isFinite(year)) return null

  const found = await searchWorkByTitle(title, year, contactEmail, apiKey)
  if (!found) return null

  const foundTitle = typeof found.title === 'string' ? found.title : ''
  const foundAuthors = (found.authorships ?? [])
    .map(a => a.author?.display_name ? formatAuthorName(a.author.display_name) : null)
    .filter((n): n is string => !!n)
  const existingAuthors = Array.isArray(fm.authors) ? fm.authors as string[] : []

  const titleSim = jaccardSimilarity(tokenize(title), tokenize(foundTitle))
  // No existing authors to compare against → trust the title alone.
  const overlap = existingAuthors.length
    ? authorOverlap(existingAuthors, foundAuthors)
    : 1

  if (titleSim >= TITLE_SIM_THRESHOLD && overlap >= AUTHOR_OVERLAP_THRESHOLD) {
    return found
  }

  return null
}

/**
 * Backfill a single existing publication file in place.
 *
 * Reads the file, resolves the work on OpenAlex, and writes only the missing
 * `openalex_id` and/or `authors_orcid` fields (plus `authors` if it is also
 * absent). The body and all other frontmatter fields are preserved.
 */
export async function backfillPublication(file: string, contactEmail: string, apiKey?: string): Promise<BackfillResult> {
  const content = readFileSync(file, 'utf-8')
  const fm = parseYamlFrontmatter(content)
  if (Object.keys(fm).length === 0) {
    return { status: 'no_match', file, reason: 'no frontmatter' }
  }

  const hasOpenalexId = typeof fm.openalex_id === 'string' && fm.openalex_id.trim() !== ''
  const hasAuthorsOrcid = Array.isArray(fm.authors_orcid) && fm.authors_orcid.length > 0
  if (hasOpenalexId && hasAuthorsOrcid) {
    return { status: 'complete' }
  }

  const work = await resolveWork(fm, contactEmail, apiKey)
  if (!work) {
    return { status: 'no_match', file, reason: 'not found on OpenAlex' }
  }

  const rawId = typeof work.id === 'string' ? work.id.replace('https://openalex.org/', '') : ''
  const updates: Record<string, unknown> = {}
  const changes: string[] = []

  if (!hasOpenalexId && rawId) {
    updates.openalex_id = rawId
    changes.push('openalex_id')
  }

  if (!hasAuthorsOrcid) {
    const existingAuthors = Array.isArray(fm.authors) ? fm.authors as string[] : []
    if (existingAuthors.length) {
      updates.authors_orcid = buildAuthorsOrcid(existingAuthors, work)
    } else {
      const { authors, authorsOrcid } = deriveAuthorsFromWork(work)
      updates.authors = authors
      updates.authors_orcid = authorsOrcid
      changes.push('authors')
    }
    changes.push('authors_orcid')
  }

  if (!changes.length) {
    return { status: 'complete' }
  }

  const newContent = updateFrontmatter(content, updates)
  if (newContent !== content) {
    writeFileSync(file, newContent, 'utf-8')
  }
  return { status: 'backfilled', file, openalexId: rawId || undefined, changes }
}

/**
 * Orchestrator: backfill every incomplete existing publication.
 *
 * Mutates each `existing[i]` in place (sets `openalexId` when newly resolved)
 * so the caller's dedup set picks up the backfilled value and the work is not
 * re-added as new. Returns the list of files that were changed.
 */
export async function backfillExisting(
  existing: ExistingPublication[],
  contactEmail: string,
  apiKey?: string
): Promise<string[]> {
  const changed: string[] = []
  const incomplete = existing.filter(e => !e.hasOpenalexId || !e.hasAuthorsOrcid)

  for (const e of incomplete) {
    try {
      const result = await backfillPublication(e.file, contactEmail, apiKey)
      if (result.status === 'backfilled') {
        changed.push(e.file)
        if (result.openalexId) e.openalexId = result.openalexId.replace(/^W/, '')
        console.log(`  [backfilled] ${e.file} (${result.changes.join(', ')})`)
      } else if (result.status === 'no_match') {
        console.warn(`  [backfill skipped] ${result.file}: ${result.reason}`)
      }
    } catch (err) {
      // One bad file shouldn't abort the whole backfill.
      console.warn(`  [backfill error] ${e.file}: ${(err as Error).message}`)
    }
  }

  return changed
}
