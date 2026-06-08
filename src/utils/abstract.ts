/**
 * Abstract reconstruction from OpenAlex inverted index
 */

/**
 * Reconstruct abstract text from inverted index format
 * OpenAlex stores abstracts as word -> positions mapping
 */
export function reconstructAbstract(invertedIndex: Record<string, number[]> | null): string | null {
  if (!invertedIndex) return null

  const entries: [string, number][] = []

  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      entries.push([word, pos])
    }
  }

  // Sort by position
  entries.sort((a, b) => a[1] - b[1])

  // Join words in order
  return entries.map(e => e[0]).join(' ')
}
