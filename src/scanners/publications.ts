/**
 * Scan existing publications from content directory
 */

import { readFileSync } from 'fs'
import { parseYamlFrontmatter } from '../utils/yaml.js'
import { findMarkdownFiles } from '../utils/glob.js'
import type { ExistingPublication } from '../types.js'

/**
 * Scan all existing publications and extract metadata for deduplication
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

    const doi = typeof fm.doi === 'string' && fm.doi ? fm.doi : undefined
    const title = typeof fm.title === 'string' ? fm.title : undefined
    const year = typeof fm.year === 'string'
      ? parseInt(fm.year)
      : (typeof fm.year === 'number' ? fm.year : undefined)

    const authors = Array.isArray(fm.authors) ? fm.authors as string[] : undefined

    existing.push({ openalexId, doi, title, year, authors })
  }

  return existing
}
