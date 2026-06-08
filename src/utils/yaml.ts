/**
 * YAML frontmatter parsing and generation utilities
 */

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseYamlFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}

  const result: Record<string, unknown> = {}
  const lines = match[1].split('\n')
  let currentKey = ''
  let currentList: string[] | null = null

  for (const line of lines) {
    const listItem = line.match(/^  - (.+)$/)
    if (listItem && currentList !== null) {
      currentList.push(listItem[1].trim().replace(/^["']|["']$/g, ''))
      continue
    }

    if (currentList !== null) {
      result[currentKey] = currentList
      currentList = null
    }

    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/)
    if (!kv) continue

    const [, key, val] = kv
    const trimmed = val.trim()

    if (trimmed === '') {
      currentKey = key
      currentList = []
    } else {
      result[key] = trimmed.replace(/^["']|["']$/g, '')
    }
  }

  if (currentList !== null) result[currentKey] = currentList
  return result
}

/**
 * Escape string value for YAML
 */
export function yamlStr(value: string): string {
  if (/[:#\[\]{}&*!,|>'"?%@`]/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}
