/**
 * markuxt-sync-publications
 *
 * GitHub Action to sync publications from OpenAlex based on member ORCIDs.
 * Fetches publications for all members with ORCID, deduplicates against
 * existing content, and writes new markdown files to
 * <publications_dir>/<year>/<openalex_id>/index.md
 *
 * Usage:
 *   - GitHub Action (see action.yml) — INPUT_* env vars are set automatically.
 *   - Local: copy .env.example to .env.development, fill values, `pnpm dev`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// Local dev: load .env / .env.<NODE_ENV> if present. No-op in CI where
// process.env is already populated by the runner.
import { loadEnvFiles } from './utils/env'
loadEnvFiles(undefined, process.env.NODE_ENV || 'development')

// Type imports
import type { PendingPublication } from './types'

// Utility imports
import { initGitHubOutput, setOutput } from './utils/github'
import { normalizeDoi } from './utils/doi'
import { processPdf } from './utils/pdf'
import { pickFilenameStem } from './utils/slugify'

// API imports
import {
  getInstitutionId,
  getAuthorId,
  getWorksForAuthor
} from './utils/openalex'

// Scanner imports
import { scanExistingPublications } from './scanners/publications'
import { scanMembersWithOrcid } from './scanners/members'

// Worker imports
import { parseWork } from './workers/parser'
import { filterDuplicates, deduplicatePending } from './workers/deduplicator'
import { backfillExisting } from './workers/backfill'
import { backfillScreenshots } from './workers/screenshot-backfill'
import { buildMarkdown } from './workers/markdown'

// ---------------------------------------------------------------------------
// Configuration
 //
// Accept both INPUT_* (GitHub Actions convention) and bare names (local dev
// convenience, see docs/code-review.md #5).
// ---------------------------------------------------------------------------

const ROR_ID = process.env.INPUT_ROR_ID || process.env.ROR_ID || ''
const CONTACT_EMAIL = process.env.INPUT_CONTACT_EMAIL || process.env.CONTACT_EMAIL || ''
const API_KEY = process.env.INPUT_OPENALEX_API_KEY || process.env.OPENALEX_API_KEY || ''
const MEMBERS_DIR_INPUT = process.env.INPUT_MEMBERS_DIR || process.env.MEMBERS_DIR || ''
const PUBLICATIONS_DIR_INPUT = process.env.INPUT_PUBLICATIONS_DIR || process.env.PUBLICATIONS_DIR || ''
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT || ''

if (!ROR_ID) {
  console.error('Error: ROR_ID (or INPUT_ROR_ID) is required')
  process.exit(1)
}

if (!CONTACT_EMAIL) {
  console.error('Error: CONTACT_EMAIL (or INPUT_CONTACT_EMAIL) is required')
  process.exit(1)
}

// MEMBERS_DIR: scanned for member markdown files with ORCIDs. Defaults to
// src/members; override via env for repos that use a different layout
// (e.g. team/, people/, authors/). Relative paths resolve against the repo
// root; absolute paths pass through.
const MEMBERS_DIR = MEMBERS_DIR_INPUT || 'src/members'

// PUBLICATIONS_DIR: where generated publication markdown + screenshots are
// written. Defaults to src/publications. Decoupled from MEMBERS_DIR so the
// two can live under different roots.
const PUBLICATIONS_DIR = PUBLICATIONS_DIR_INPUT || 'src/publications'

// Initialize GitHub output (no-op locally when GITHUB_OUTPUT is empty)
initGitHubOutput(GITHUB_OUTPUT)

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[markuxt-sync-publications] Starting...`)
  console.log(`[markuxt-sync-publications] ROR ID: ${ROR_ID}`)
  console.log(`[markuxt-sync-publications] Publications dir: ${PUBLICATIONS_DIR}`)
  console.log(`[markuxt-sync-publications] Members dir: ${MEMBERS_DIR}`)
  console.log(`[markuxt-sync-publications] OpenAlex pool: ${API_KEY ? 'premium (api_key)' : 'polite (mailto)'}`)

  // 1. Resolve institution OpenAlex ID
  const institutionId = await getInstitutionId(ROR_ID, CONTACT_EMAIL, API_KEY)
  console.log(`[markuxt-sync-publications] Institution ID: ${institutionId}`)

  // 2. Scan existing publications
  const existing = await scanExistingPublications(PUBLICATIONS_DIR)
  console.log(`[markuxt-sync-publications] Found ${existing.length} existing publications`)

  // 2a. Backfill existing publications that are missing openalex_id and/or
  // authors_orcid, by looking them up on OpenAlex. Idempotent — it only
  // fills missing fields and preserves the body. Runs before the dedup sets
  // are built so newly-resolved IDs suppress the same works from being
  // re-added as new.
  const backfilledFiles = await backfillExisting(existing, CONTACT_EMAIL, API_KEY)
  console.log(`[markuxt-sync-publications] Backfilled ${backfilledFiles.length} existing publication(s)`)

  // 2b. Backfill abstract-page screenshots for existing publications that have
  // a reachable OA PDF but no screenshot yet. Idempotent — pubs that already
  // have an abstract_screenshot are skipped, so this only does work the first
  // time (or when a previously-unreachable PDF becomes reachable).
  const screenshotFiles = await backfillScreenshots(existing, CONTACT_EMAIL, API_KEY)
  console.log(`[markuxt-sync-publications] Added screenshots to ${screenshotFiles.length} existing publication(s)`)

  const existingOpenalexIds = new Set(
    existing.map(p => p.openalexId).filter((id): id is string => !!id)
  )
  const existingDois = new Set(
    existing
      .map(p => normalizeDoi(p.doi))
      .filter((d): d is string => !!d)
  )

  // 3. Scan members with ORCID
  const members = await scanMembersWithOrcid(MEMBERS_DIR)
  console.log(`[markuxt-sync-publications] Found ${members.length} members with ORCID`)

  // 4. Fetch works from OpenAlex for each member
  const allWorks = new Map<string, PendingPublication>()

  for (const member of members) {
    console.log(`[markuxt-sync-publications] Processing ${member.name} (${member.orcid})...`)
    const authorId = await getAuthorId(member.orcid, CONTACT_EMAIL, API_KEY)

    if (!authorId) {
      console.warn(`  → Not found on OpenAlex: ${member.orcid}`)
      continue
    }

    console.log(`  → Author ID: ${authorId}`)
    const works = await getWorksForAuthor(authorId, institutionId, CONTACT_EMAIL, API_KEY)
    console.log(`  → ${works.length} works`)

    for (const w of works) {
      const pub = parseWork(w)
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
  //
  // Layout (flat per year, no per-paper subdirectory):
  //   <publications_dir>/<year>/<title-slug>.md
  //   <publications_dir>/<year>/<title-slug>.png   (when OA PDF screenshot rendered)
  //
  // The slug is derived from the paper title via slugify(); empty / colliding
  // titles fall back to the OpenAlex ID (see src/utils/slugify.ts).
  const newFiles: string[] = []
  const usedStemsByYear = new Map<string, Set<string>>()

  for (const pub of toWrite) {
    const yearKey = String(pub.year)
    const yearDir = join(PUBLICATIONS_DIR, yearKey)
    if (!existsSync(yearDir)) mkdirSync(yearDir, { recursive: true })

    // Track used filename stems per-year so within-batch collisions are
    // resolved deterministically (first occurrence keeps the bare slug).
    let used = usedStemsByYear.get(yearKey)
    if (!used) {
      used = new Set<string>()
      usedStemsByYear.set(yearKey, used)
    }
    const stem = pickFilenameStem(pub.title, pub.openalexId, used)
    used.add(stem)

    // 7a. PDF: download, locate abstract page, render screenshot.
    //     Failures are graceful — we still emit the markdown with whatever
    //     metadata we have. We only run this for OA papers with a PDF URL.
    if (pub.pdfUrl && !pub.hidden) {
      try {
        const result = await processPdf(pub, yearDir, stem)
        pub.pdfUrl = result.pdfUrl
        pub.abstractPage = result.abstractPage
        pub.abstractScreenshot = result.screenshotPath
        if (result.skipped) {
          console.log(`  [pdf skipped] ${result.reason ?? 'unknown reason'}`)
        } else {
          console.log(`  [pdf] page ${result.abstractPage} → ${result.screenshotPath}`)
        }
      } catch (err) {
        // Defensive — processPdf is meant to never throw, but if it does we
        // don't want to lose the publication.
        console.warn(`  [pdf error] ${(err as Error).message}`)
      }
    }

    const filePath = join(yearDir, `${stem}.md`)
    writeFileSync(filePath, buildMarkdown(pub), 'utf-8')
    console.log(`  [${pub.hidden ? 'hidden' : 'visible'}] ${filePath}`)
    newFiles.push(filePath)
  }

  // 8. Set GitHub Actions outputs.
  // Names match action.yml's published contract (see docs/code-review.md #3).
  setOutput('new_publications_count', String(newFiles.length))
  setOutput('new_publications_files', newFiles.join('\n'))
  setOutput('backfilled_publications_count', String(backfilledFiles.length))
  setOutput('backfilled_publications_files', backfilledFiles.join('\n'))
  setOutput('screenshots_backfilled_count', String(screenshotFiles.length))
  setOutput('screenshots_backfilled_files', screenshotFiles.join('\n'))

  console.log(`[markuxt-sync-publications] Done. Added ${newFiles.length} publication files.`)
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('[markuxt-sync-publications] Fatal:', err)
  process.exit(1)
})
