#!/usr/bin/env -S npx tsx

/**
 * markuxt-sync-publications
 *
 * GitHub Action to sync publications from OpenAlex based on member ORCIDs.
 * Fetches publications for all members with ORCID, deduplicates against existing
 * content, and writes new markdown files to <content_dir>/publications/<year>/<openalex_id>/index.md
 *
 * Usage: Called via GitHub Action (see action.yml) or directly:
 *   ROR_ID="https://ror.org/..." CONTACT_EMAIL="..." CONTENT_DIR="src" npx tsx src/index.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// Type imports
import type { PendingPublication, ExistingPublication } from './types.js'

// Utility imports
import { yamlStr } from './utils/yaml.js'
import { initGitHubOutput, setOutput } from './utils/github.js'

// API imports
import {
  getInstitutionId,
  getAuthorId,
  getWorksForAuthor
} from './utils/openalex.js'

// Scanner imports
import { scanExistingPublications } from './scanners/publications.js'
import { scanMembersWithOrcid } from './scanners/members.js'

// Worker imports
import { parseWork } from './workers/parser.js'
import { filterDuplicates, deduplicatePending } from './workers/deduplicator.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROR_ID = process.env.INPUT_ROR_ID || ''
const CONTACT_EMAIL = process.env.INPUT_CONTACT_EMAIL || ''
const CONTENT_DIR = process.env.INPUT_CONTENT_DIR || 'src'
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT || ''

if (!ROR_ID) {
  console.error('Error: INPUT_ROR_ID is required')
  process.exit(1)
}

if (!CONTACT_EMAIL) {
  console.error('Error: INPUT_CONTACT_EMAIL is required')
  process.exit(1)
}

const PUBLICATIONS_DIR = join(CONTENT_DIR, 'publications')
const MEMBERS_DIR = join(CONTENT_DIR, 'members')

// Initialize GitHub output
initGitHubOutput(GITHUB_OUTPUT)

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

function buildMarkdown(pub: PendingPublication): string {
  const lines: string[] = ['---', `_hidden: ${pub.hidden}`]

  lines.push(`title: ${yamlStr(pub.title)}`)
  lines.push('authors:')
  for (const a of pub.authors) lines.push(`  - ${yamlStr(a)}`)
  lines.push('authors_orcid:')
  for (const o of pub.authorsOrcid) lines.push(`  - ${o ?? 'null'}`)
  lines.push(`year: ${pub.year}`)
  lines.push(`doi: ${pub.doi ? yamlStr(pub.doi) : ''}`)
  lines.push(`openalex_id: ${pub.openalexId}`)
  lines.push(`venue: ${pub.venue ? yamlStr(pub.venue) : ''}`)

  if (pub.keywords.length) {
    lines.push('keywords:')
    for (const k of pub.keywords) lines.push(`  - ${yamlStr(k)}`)
  } else {
    lines.push('keywords: []')
  }

  lines.push('---', '')
  if (pub.abstract) lines.push(pub.abstract, '')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[markuxt-sync-publications] Starting...`)
  console.log(`[markuxt-sync-publications] ROR ID: ${ROR_ID}`)
  console.log(`[markuxt-sync-publications] Content dir: ${CONTENT_DIR}`)

  // 1. Resolve institution OpenAlex ID
  const institutionId = await getInstitutionId(ROR_ID, CONTACT_EMAIL)
  console.log(`[markuxt-sync-publications] Institution ID: ${institutionId}`)

  // 2. Scan existing publications
  const existing = await scanExistingPublications(PUBLICATIONS_DIR)
  const existingOpenalexIds = new Set(
    existing.map(p => p.openalexId).filter((id): id is string => !!id)
  )
  const existingDois = new Set(
    existing
      .map(p => p.doi?.toLowerCase().replace(/https?:\/\/doi\.org\//i, ''))
      .filter((d): d is string => !!d)
  )
  console.log(`[markuxt-sync-publications] Found ${existing.length} existing publications`)

  // 3. Scan members with ORCID
  const members = await scanMembersWithOrcid(MEMBERS_DIR)
  console.log(`[markuxt-sync-publications] Found ${members.length} members with ORCID`)

  // 4. Fetch works from OpenAlex for each member
  const allWorks = new Map<string, PendingPublication>()

  for (const member of members) {
    console.log(`[markuxt-sync-publications] Processing ${member.name} (${member.orcid})...`)
    const authorId = await getAuthorId(member.orcid, CONTACT_EMAIL)

    if (!authorId) {
      console.warn(`  → Not found on OpenAlex: ${member.orcid}`)
      continue
    }

    console.log(`  → Author ID: ${authorId}`)
    const works = await getWorksForAuthor(authorId, institutionId, CONTACT_EMAIL)
    console.log(`  → ${works.length} works`)

    for (const w of works) {
      const pub = parseWork(w as Record<string, unknown>)
      if (!pub) continue
      if (!allWorks.has(pub.openalexId)) allWorks.set(pub.openalexId, pub)
    }
  }

  console.log(`[markuxt-sync-publications] Total unique works from OpenAlex: ${allWorks.size}`)

  // 5. Filter out already-existing works
  const pending = filterDuplicates(allWorks, existing, existingOpenalexIds, existingDois)
  console.log(`[markuxt-sync-publications] After dedup vs existing: ${pending.length} to add`)

  // 6. Dedup within pending list, keep newest per group
  const toWrite = deduplicatePending(pending)

  const visible = toWrite.filter(p => !p.hidden).length
  const hidden = toWrite.filter(p => p.hidden).length
  console.log(`[markuxt-sync-publications] Writing ${toWrite.length} files (${visible} visible, ${hidden} hidden)`)

  // 7. Write markdown files
  const newFiles: string[] = []

  for (const pub of toWrite) {
    const dir = join(PUBLICATIONS_DIR, String(pub.year), pub.openalexId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const filePath = join(dir, 'index.md')
    writeFileSync(filePath, buildMarkdown(pub), 'utf-8')
    console.log(`  [${pub.hidden ? 'hidden' : 'visible'}] ${filePath}`)
    newFiles.push(filePath)
  }

  // 8. Set GitHub Actions outputs
  setOutput('count', String(newFiles.length))
  setOutput('files', newFiles.join('\n'))

  console.log(`[markuxt-sync-publications] Done. Added ${newFiles.length} publication files.`)
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('[markuxt-sync-publications] Fatal:', err)
  process.exit(1)
})
