/**
 * Formatter utilities for author names and ORCID IDs
 */

/**
 * Format OpenAlex display name to "LastName, FirstName" format
 * Example: "John Doe" → "Doe, John"
 */
export function formatAuthorName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]

  const last = parts[parts.length - 1]
  const first = parts.slice(0, -1).join(' ')

  return `${last}, ${first}`
}

/**
 * Extract ORCID ID from ORCID URL
 * Example: "https://orcid.org/0000-0001-2345-6789" → "0000-0001-2345-6789"
 */
export function extractOrcidId(orcidUrl: string | null): string | null {
  if (!orcidUrl) return null

  const match = orcidUrl.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/)
  return match ? match[1] : null
}

/**
 * Format author list for display
 * - 1-2 authors: show all names separated by " & "
 * - 3+ authors: show "First Author et al."
 */
export function formatAuthors(authors: string[] | undefined): string {
  if (!Array.isArray(authors) || authors.length === 0) return ''
  if (authors.length <= 2) return authors.join(' & ')
  return `${authors[0]} et al.`
}
