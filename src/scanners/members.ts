/**
 * Scan members with ORCID from content directory.
 *
 * Member markdown files live under `<members_dir>` (default `src/members`, any depth) and
 * must have an `orcid` field in their YAML frontmatter to be picked up.
 * Members with `_hidden: true` are skipped.
 *
 * ORCIDs are validated using the standard 16-digit (with checksum) pattern.
 * Invalid ORCIDs are skipped with a warning so a typo in one file can't
 * poison the whole sync.
 */

import { readFileSync } from 'fs'
import { parseYamlFrontmatter } from '../utils/yaml'
import { findMarkdownFiles } from '../utils/glob'
import { groupVariantsByPriority } from '../utils/locale-variants'
import { extractOrcidId } from '../utils/formatters'
import type { MemberInfo } from '../types'

const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

/**
 * Validate an ORCID using the ISO 7064 11-2 checksum.
 * (https://support.orcid.org/hc/en-us/articles/360006897674)
 */
function isValidOrcid(orcid: string): boolean {
  if (!ORCID_PATTERN.test(orcid)) return false

  // Compute checksum: total mod 11 must equal the check digit (X = 10).
  const digits = orcid.replace(/-/g, '')
  let total = 0
  for (let i = 0; i < 15; i++) {
    total = (total + Number(digits[i])) * 2
  }
  const remainder = total % 11
  const checkDigit = (12 - remainder) % 11
  const expected = checkDigit === 10 ? 'X' : String(checkDigit)
  return digits[15] === expected
}

/**
 * Scan all members and filter those with a valid ORCID.
 *
 * Locale variants of one member (`name.md` + `name.zh-CN.md`) are treated as a
 * single member. Fields are merged PER FIELD in priority order — default
 * (non-suffixed) file first, then remaining variants alphabetically — so a
 * field the default omits (e.g. `orcid` only present in a locale variant) is
 * still picked up from the first variant that defines it. See
 * `utils/locale-variants.ts` (`groupVariantsByPriority`).
 */
export async function scanMembersWithOrcid(membersDir: string): Promise<MemberInfo[]> {
  const groups = groupVariantsByPriority(await findMarkdownFiles(membersDir))
  const members: MemberInfo[] = []

  for (const files of groups) {
    let name: string | undefined
    let orcid: string | undefined

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const fm = parseYamlFrontmatter(content)

      // Skip hidden variants (other variants of the same member can still contribute).
      if (fm._hidden === 'true' || fm._hidden === true) continue

      if (!name && typeof fm.name === 'string') {
        name = fm.name
      }

      if (!orcid) {
        const rawOrcid = typeof fm.orcid === 'string' ? fm.orcid.trim() : ''
        if (rawOrcid) {
          const candidate = extractOrcidId(rawOrcid)
          if (candidate && isValidOrcid(candidate)) {
            orcid = candidate
          } else {
            console.warn(`[members] ${file}: invalid ORCID "${rawOrcid}"`)
          }
        }
      }

      // Stop reading more variants once we have both fields.
      if (name && orcid) break
    }

    if (orcid) {
      members.push({ name: name || 'Unknown', orcid })
    }
  }

  return members
}

// Exported for tests
export const _internal = { isValidOrcid }
