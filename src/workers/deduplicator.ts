/**
 * Deduplication worker for processing pending publications
 */

import type { PendingPublication, ExistingPublication } from '../types.js'
import { isDuplicate } from '../utils/deduplication.js'

/**
 * Filter out publications that already exist
 */
export function filterDuplicates(
  pending: Map<string, PendingPublication>,
  existing: ExistingPublication[],
  existingOpenalexIds: Set<string>,
  existingDois: Set<string>
): PendingPublication[] {
  const result: PendingPublication[] = []

  for (const pub of pending.values()) {
    const shortId = pub.openalexId.replace(/^W/, '')

    // Skip if OpenAlex ID exists
    if (existingOpenalexIds.has(shortId)) continue

    // Skip if DOI exists
    const doiKey = pub.doi?.toLowerCase().replace(/https?:\/\/doi\.org\//i, '')
    if (doiKey && existingDois.has(doiKey)) continue

    // Check similarity-based duplicates
    const dupOfExisting = existing.some(e =>
      e.title && e.year != null &&
      isDuplicate(
        { title: pub.title, year: pub.year, authors: pub.authors },
        { title: e.title, year: e.year, authors: e.authors ?? [] }
      )
    )

    if (dupOfExisting) continue

    result.push(pub)
  }

  return result
}

/**
 * Deduplicate within pending list, keep newest per group
 */
export function deduplicatePending(pending: PendingPublication[]): PendingPublication[] {
  const toWrite: PendingPublication[] = []
  const consumed = new Set<number>()

  for (let i = 0; i < pending.length; i++) {
    if (consumed.has(i)) continue

    const group: number[] = [i]

    // Find all duplicates within pending list
    for (let j = i + 1; j < pending.length; j++) {
      if (consumed.has(j)) continue

      const a = pending[i]
      const b = pending[j]

      const sameDoi = !!(a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase())
      const sameTitle = a.title.toLowerCase().trim() === b.title.toLowerCase().trim()
      const similar = isDuplicate(
        { title: a.title, year: a.year, authors: a.authors },
        { title: b.title, year: b.year, authors: b.authors }
      )

      if (sameDoi || sameTitle || similar) {
        group.push(j)
        consumed.add(j)
      }
    }

    consumed.add(i)

    // Sort group: newest first; hide all but the first
    group.sort((x, y) => pending[y].year - pending[x].year)

    for (let k = 0; k < group.length; k++) {
      toWrite.push({ ...pending[group[k]], hidden: k > 0 })
    }
  }

  return toWrite
}
