/**
 * Deduplication utilities for publications
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'with', 'by', 'from',
  'at', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'that', 'this', 'these',
  'those', 'it', 'its'
])

/**
 * Tokenize title into words (removing stop words)
 */
export function tokenize(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w))
  )
}

/**
 * Calculate Jaccard similarity between two token sets
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1

  let intersection = 0
  for (const w of a) {
    if (b.has(w)) intersection++
  }

  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Calculate author overlap ratio between two author lists
 */
export function authorOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0

  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '')
  const setA = new Set(a.map(normalize))
  const setB = new Set(b.map(normalize))

  let intersection = 0
  for (const n of setA) {
    if (setB.has(n)) intersection++
  }

  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Check if two publications are likely duplicates
 */
export function isDuplicate(
  candidate: { title: string; year: number; authors: string[] },
  existing: { title: string; year: number; authors: string[] }
): boolean {
  // Exact title match
  if (candidate.title.toLowerCase().trim() === existing.title.toLowerCase().trim()) {
    return true
  }

  // Years must be adjacent
  if (Math.abs(candidate.year - existing.year) > 1) return false

  // Check similarity thresholds
  const titleSim = jaccardSimilarity(tokenize(candidate.title), tokenize(existing.title))
  const authorSim = authorOverlap(candidate.authors, existing.authors)

  return titleSim >= 0.85 && authorSim >= 0.5
}
