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
import { parseYamlFrontmatter } from '../utils/yaml.js'
import { findMarkdownFiles } from '../utils/glob.js'
import { extractOrcidId } from '../utils/formatters.js'
import type { MemberInfo } from '../types.js'

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
 */
export async function scanMembersWithOrcid(membersDir: string): Promise<MemberInfo[]> {
  const files = await findMarkdownFiles(membersDir)
  const members: MemberInfo[] = []

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const fm = parseYamlFrontmatter(content)

    // Skip hidden members
    if (fm._hidden === 'true' || fm._hidden === true) continue

    const rawOrcid = typeof fm.orcid === 'string' ? fm.orcid.trim() : ''
    if (!rawOrcid) continue

    const orcid = extractOrcidId(rawOrcid)
    if (!orcid || !isValidOrcid(orcid)) {
      console.warn(`[members] Skipping ${file}: invalid ORCID "${rawOrcid}"`)
      continue
    }

    members.push({
      name: typeof fm.name === 'string' ? fm.name : 'Unknown',
      orcid
    })
  }

  return members
}

// Exported for tests
export const _internal = { isValidOrcid }
