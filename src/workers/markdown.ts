/**
 * Render a PendingPublication as a publication markdown file (frontmatter +
 * reconstructed-abstract body).
 *
 * Extracted from index.ts so it can be unit-tested directly (index.ts has
 * top-level side effects and can't be imported in tests).
 *
 * `pdf_url` and `abstract_page` are deliberately NOT emitted — they are
 * internal download details used to render the screenshot, not publication
 * metadata.
 */

import { yamlStr } from '../utils/yaml'
import type { PendingPublication } from '../types'

export function buildMarkdown(pub: PendingPublication): string {
  const lines: string[] = ['---', `_hidden: ${pub.hidden}`]

  lines.push(`title: ${yamlStr(pub.title)}`)
  lines.push('authors:')
  for (const a of pub.authors) lines.push(`  - ${yamlStr(a)}`)
  lines.push('authors_orcid:')
  for (const o of pub.authorsOrcid) lines.push(`  - ${o ?? 'null'}`)
  lines.push(`year: ${pub.year}`)
  lines.push(`doi: ${pub.doi ? yamlStr(pub.doi) : ''}`)
  lines.push(`openalex_id: ${pub.openalexId}`)
  lines.push(`venue: ${pub.venue ? yamlStr(pub.venue) : ''}`)
  lines.push(`abstract_screenshot: ${pub.abstractScreenshot ? yamlStr(pub.abstractScreenshot) : ''}`)

  if (pub.keywords.length) {
    lines.push('keywords:')
    for (const k of pub.keywords) lines.push(`  - ${yamlStr(k)}`)
  } else {
    lines.push('keywords: []')
  }

  lines.push('---', '')
  if (pub.abstract) lines.push(pub.abstract, '')

  return lines.join('\n')
}
