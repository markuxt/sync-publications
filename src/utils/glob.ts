/**
 * Glob utilities for file system operations
 */

import { glob } from 'glob'
import { readFileSync } from 'fs'

/**
 * Default glob options for markdown files
 */
export const DEFAULT_GLOB_OPTIONS = {
  absolute: true,
  dot: false,    // Skip dotfiles
  nodir: true,   // Skip directories
  unique: true   // Ensure uniqueness
} as const

/**
 * Find all markdown files in a directory
 */
export async function findMarkdownFiles(
  cwd: string,
  pattern: string = '**/*.md'
): Promise<string[]> {
  return glob(pattern, { ...DEFAULT_GLOB_OPTIONS, cwd })
}

/**
 * Find and read markdown files
 */
export async function readMarkdownFiles(
  cwd: string,
  pattern: string = '**/*.md'
): Promise<Array<{ path: string; content: string }>> {
  const files = await findMarkdownFiles(cwd, pattern)

  return files.map(path => ({
    path,
    content: readFileSync(path, 'utf-8')
  }))
}

/**
 * Filter markdown files by frontmatter field
 */
export async function filterByFrontmatter(
  cwd: string,
  fieldName: string,
  fieldValue: string | boolean
): Promise<string[]> {
  const files = await readMarkdownFiles(cwd)

  return files
    .filter(({ content }) => {
      // Simple check for field existence
      const pattern = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm')
      const match = content.match(pattern)

      if (!match) return false

      if (typeof fieldValue === 'boolean') {
        return match[1].trim() === String(fieldValue)
      }

      return match[1].trim() === fieldValue
    })
    .map(({ path }) => path)
}
