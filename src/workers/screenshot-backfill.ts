/**
 * Backfill abstract-page screenshots for existing publications.
 *
 * The main sync only renders a screenshot when it writes a NEW publication.
 * This pass gives existing publications (written by hand or by an older run,
 * before a PDF was reachable) a chance to get one: for each publication that
 * has an OpenAlex ID but no `abstract_screenshot`, it re-queries OpenAlex for
 * the work's OA pdf_urls, downloads the PDF, locates the abstract page, renders
 * the PNG next to the `.md`, and writes the `abstract_screenshot` field.
 *
 * Idempotent: publications that already have an `abstract_screenshot` are
 * skipped, so this only does work the first time, or when a previously
 * unreachable PDF becomes reachable.
 */

import { readFileSync, writeFileSync } from 'fs'
import { basename, dirname } from 'path'
import type { ExistingPublication } from '../types'
import { getWorkByOpenalexId, WORK_FIELDS } from '../utils/openalex'
import { parseWork } from './parser'
import { processPdf } from '../utils/pdf'
import { parseYamlFrontmatter, updateFrontmatter } from '../utils/yaml'

/** Body text = everything after the closing frontmatter fence. */
function extractBody(content: string): string {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/)
  return m ? m[1].trim() : ''
}

/**
 * Render screenshots for existing publications missing them. Returns the list
 * of files that gained a screenshot. Never throws per-file — a bad download is
 * a skip, not an abort.
 */
export async function backfillScreenshots(
  existing: ExistingPublication[],
  contactEmail: string,
  apiKey?: string
): Promise<string[]> {
  const changed: string[] = []

  for (const e of existing) {
    if (!e.openalexId) continue

    let content: string
    try {
      content = readFileSync(e.file, 'utf-8')
    } catch {
      continue
    }

    const fm = parseYamlFrontmatter(content)
    // Already has a screenshot — nothing to do.
    if (typeof fm.abstract_screenshot === 'string' && fm.abstract_screenshot.trim()) continue

    // pdf_url is not stored in the file, so re-query OpenAlex for the current
    // set of OA pdf_urls (+ reconstructed abstract as a fallback).
    const work = await getWorkByOpenalexId(e.openalexId, contactEmail, apiKey, WORK_FIELDS)
    if (!work) continue
    const pub = parseWork(work)
    if (!pub || !pub.pdfUrls.length) continue

    const abstract = extractBody(content) || pub.abstract
    const stem = basename(e.file, '.md')
    const outDir = dirname(e.file)

    let result
    try {
      result = await processPdf(
        { abstract: abstract || null, pdfUrl: pub.pdfUrl, pdfUrls: pub.pdfUrls },
        outDir,
        stem
      )
    } catch (err) {
      console.warn(`  [screenshot error] ${e.file}: ${(err as Error).message}`)
      continue
    }
    if (!result.screenshotPath) continue

    const newContent = updateFrontmatter(content, { abstract_screenshot: result.screenshotPath })
    if (newContent !== content) {
      writeFileSync(e.file, newContent, 'utf-8')
      changed.push(e.file)
      console.log(`  [screenshot] ${e.file} → ${result.screenshotPath}`)
    }
  }

  return changed
}
