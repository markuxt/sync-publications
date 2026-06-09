/**
 * Scan existing publications from content directory.
 *
 * Addresses docs/code-review.md #15 — explicit radix for parseInt.
 */

import { readFileSync } from 'fs'
import { parseYamlFrontmatter } from '../utils/yaml.js'
import { findMarkdownFiles } from '../utils/glob.js'
import { normalizeDoi } from '../utils/doi.js'
import type { ExistingPublication } from '../types.js'

/**
 * Scan all existing publications and extract metadata for deduplication.
 *
 * Note: we keep raw `openalex_id` (with leading W) here — the comparison
 * set in `index.ts` strips the W so both forms of stored ID match.
 */
export async function scanExistingPublications(
  publicationsDir: string
): Promise<ExistingPublication[]> {
  const files = await findMarkdownFiles(publicationsDir)
  const existing: ExistingPublication[] = []

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const fm = parseYamlFrontmatter(content)

    // Skip hidden publications
    if (fm._hidden === 'true' || fm._hidden === true) continue

    const openalexId = typeof fm.openalex_id === 'string'
      ? fm.openalex_id.replace(/^W/, '')
      : undefined

    const doi = normalizeDoi(typeof fm.doi === 'string' ? fm.doi : null)

    const title = typeof fm.title === 'string' ? fm.title : undefined

    const year = typeof fm.year === 'number'
      ? fm.year
      : (typeof fm.year === 'string' ? parseInt(fm.year, 10) : undefined)

    const authors = Array.isArray(fm.authors) ? fm.authors as string[] : undefined

    existing.push({
      file,
      openalexId,
      doi: doi ?? undefined,
      title,
      year,
      authors,
      hasOpenalexId: typeof fm.openalex_id === 'string' && fm.openalex_id.trim() !== '',
      hasAuthorsOrcid: Array.isArray(fm.authors_orcid) && fm.authors_orcid.length > 0
    })
  }

  return existing
}
