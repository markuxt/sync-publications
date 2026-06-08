/**
 * Scan members with ORCID from content directory
 */

import { readFileSync } from 'fs'
import { parseYamlFrontmatter } from '../utils/yaml.js'
import { findMarkdownFiles } from '../utils/glob.js'
import type { MemberInfo } from '../types.js'

/**
 * Scan all members and filter those with ORCID
 */
export async function scanMembersWithOrcid(membersDir: string): Promise<MemberInfo[]> {
  const files = await findMarkdownFiles(membersDir)
  const members: MemberInfo[] = []

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const fm = parseYamlFrontmatter(content)

    // Skip hidden members
    if (fm._hidden === 'true' || fm._hidden === true) continue

    // Only include members with ORCID
    if (typeof fm.orcid === 'string' && fm.orcid.trim()) {
      members.push({
        name: String(fm.name ?? 'Unknown'),
        orcid: fm.orcid.trim()
      })
    }
  }

  return members
}
