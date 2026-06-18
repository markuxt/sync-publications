/**
 * YAML frontmatter parsing and generation utilities.
 *
 * Replaced the hand-rolled parser with the `yaml` package to address
 * docs/code-review.md #9 — the previous parser only returned strings,
 * didn't understand inline arrays / block scalars / comments, and was
 * brittle under any user editing.
 */

import { parse as yamlParse, stringify as yamlStringify, parseDocument } from 'yaml'

/**
 * Parse the YAML frontmatter block from a markdown file.
 *
 * Returns an empty object if no frontmatter is present. Throws up to the
 * caller for malformed YAML — better to fail loudly than to silently drop
 * fields.
 */
export function parseYamlFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  return yamlParse(match[1]) ?? {}
}

/**
 * Escape a string value for use as a YAML scalar.
 *
 * We delegate to `yaml.stringify` of a single value so we always get correct
 * quoting, including for strings containing `:`, leading/trailing whitespace,
 * CJK characters, etc.
 *
 * Empty string is special-cased to return '' so callers writing
 * `field: ${yamlStr(value)}` produce a clean `field: ` instead of `field: ""`.
 */
export function yamlStr(value: string): string {
  if (value === '') return ''
  // Frontmatter fields such as `title:` and `venue:` are emitted inline.
  // If upstream metadata contains an actual line break, writing it back
  // verbatim would produce invalid YAML like:
  //   title: first line
  //   second line
  // Collapse line separators to a single space before stringifying.
  const normalized = value.replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ')
  // lineWidth: 0 disables wrapping. Without it, long scalars (e.g. a title
  // containing ": " that gets quoted) are folded across lines, and when emitted
  // inline as `title: \u2026` the continuation lands at column 0 \u2014 invalid YAML that
  // this same parser then rejects on re-scan (breaking idempotency). Matches
  // updateFrontmatter's toString({ lineWidth: 0 }).
  const doc = yamlStringify(normalized, { defaultStringType: 'PLAIN', lineWidth: 0 })
  return doc.replace(/\n$/, '')
}

/**
 * Stringify an arbitrary value as YAML (for tests / structured output).
 */
export function stringifyYaml(value: unknown): string {
  return yamlStringify(value)
}

/**
 * Surgically update frontmatter fields while preserving everything else.
 *
 * Uses the `yaml` package's parseDocument round-trip so untouched keys keep
 * their original scalar quoting and order (minimal diff). The document body
 * (everything after the closing `---`) is spliced back byte-for-byte.
 *
 * Values may be scalars or arrays; arrays render as block lists, matching
 * buildMarkdown's output. Returns the content unchanged if it has no
 * frontmatter block.
 */
export function updateFrontmatter(content: string, updates: Record<string, unknown>): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content

  const fmText = match[1]
  // Body = everything after the closing `---` fence (verbatim).
  const body = content.slice((match.index ?? 0) + match[0].length)
  const eol = content.startsWith('---\r\n') ? '\r\n' : '\n'

  const doc = parseDocument(fmText)
  for (const [key, value] of Object.entries(updates)) {
    doc.set(key, value)
  }
  let newFm = doc.toString({ lineWidth: 0 })
  if (eol === '\r\n') newFm = newFm.replace(/\n/g, '\r\n')

  return `---${eol}${newFm}${eol}---${body}`
}
