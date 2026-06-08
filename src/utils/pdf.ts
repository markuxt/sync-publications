/**
 * PDF download, text extraction, and abstract-page screenshot rendering.
 *
 * Pipeline per publication:
 *   1. Resolve the best open-access PDF URL from OpenAlex work metadata.
 *   2. Download the PDF (with timeout + retry via fetchWithRetry).
 *   3. Extract per-page text using `unpdf` (pure JS — wraps pdfjs-dist).
 *   4. Locate the page whose text has the longest overlap with the
 *      reconstructed abstract — typically page 1.
 *   5. Render that page to PNG.
 *
 * Screenshot backend selection (in priority order):
 *   a. `pdftoppm` (poppler) — fastest, available on ubuntu-latest runners
 *      by default. Not available on a clean macOS; users must
 *      `brew install poppler` if they want screenshots locally.
 *   b. None — graceful skip. We still emit the markdown with abstract text
 *      and PDF URL; only the screenshot field is empty.
 *
 * Resolution: rendered at 200 DPI for US-Letter (~1700x2200) so the
 * shorter side comfortably exceeds the 1000 px requirement.
 */

import { spawn } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, unlinkSync, renameSync } from 'fs'
import { join, extname } from 'path'
import { extractText } from 'unpdf'
import { fetchWithRetry } from './http.js'
import type { OpenAlexWork, PdfProcessResult } from '../types.js'

const SCREENSHOT_DPI = 200
const MIN_SHORT_SIDE_PX = 1000
const MAX_PDF_BYTES = 50 * 1024 * 1024 // 50 MB hard cap

/**
 * Pick the best PDF URL from an OpenAlex work object.
 * Priority: best_oa_location.pdf_url > primary_location.pdf_url
 * > open_access.oa_url (only if it looks like a PDF).
 */
export function pickPdfUrl(work: OpenAlexWork): string | null {
  const candidates: (string | null | undefined)[] = [
    work.best_oa_location?.pdf_url,
    work.primary_location?.pdf_url,
    work.open_access?.oa_url
  ]

  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue
    if (!/^https?:\/\//i.test(c)) continue
    // If we can't tell it's a PDF by extension or explicit content-type,
    // still accept — many OA landing URLs serve PDFs without .pdf suffix.
    return c
  }
  return null
}

/**
 * Download a PDF into a buffer. Enforces a size cap and a sensible timeout.
 * Returns null if the URL is unreachable or the response isn't a PDF.
 */
export async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetchWithRetry(url, {
      timeoutMs: 60_000,
      retries: 2
    })
    if (!res.ok) {
      console.warn(`[pdf] download failed (${res.status}): ${url}`)
      return null
    }

    const contentType = res.headers.get('content-type') ?? ''
    const looksLikePdf =
      contentType.includes('application/pdf') ||
      /\.pdf(\?|$)/i.test(url)

    if (!looksLikePdf) {
      console.warn(`[pdf] not a PDF (content-type=${contentType || 'unknown'}): ${url}`)
      return null
    }

    const contentLength = Number(res.headers.get('content-length') ?? 0)
    if (contentLength > MAX_PDF_BYTES) {
      console.warn(`[pdf] too large (${contentLength} bytes): ${url}`)
      return null
    }

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_PDF_BYTES) {
      console.warn(`[pdf] too large (${buf.length} bytes): ${url}`)
      return null
    }

    // First bytes should be %PDF
    if (buf.length < 5 || buf.subarray(0, 5).toString() !== '%PDF-') {
      console.warn(`[pdf] bad magic: ${url}`)
      return null
    }

    return buf
  } catch (err) {
    console.warn(`[pdf] download error: ${(err as Error).message}`)
    return null
  }
}

/**
 * Per-page text extraction. Returns an array indexed (0-based) per page.
 *
 * `unpdf.extractText` with `mergePages: false` returns `{ totalPages, text: string[] }`
 * where `text[i]` is the full text of page i+1.
 */
export async function extractPageText(pdfBuffer: Buffer): Promise<string[]> {
  const { text } = await extractText(pdfBuffer, { mergePages: false })
  return text
}

/**
 * Locate the page most likely to contain the abstract.
 *
 * Strategy: tokenise the abstract into lower-case words, then count how
 * many of those words appear (as substrings, case-insensitive) in each
 * page's text. The page with the highest count wins. Ties → earliest page.
 *
 * Returns the 1-indexed page number, or null if no page has any overlap
 * (e.g. the PDF is a preprint without the abstract, or text extraction
 * failed).
 */
export function locateAbstractPage(
  abstract: string | null,
  pageTexts: string[]
): number | null {
  if (!abstract) return null
  if (!pageTexts.length) return null

  // Filter to non-trivial tokens (≥4 chars) for resilience to OCR noise.
  const tokens = abstract
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4)
  // Dedupe so a repeated word in the abstract doesn't dominate scoring.
  const uniqueTokens = Array.from(new Set(tokens))

  if (!uniqueTokens.length) return null

  let bestPage = -1
  let bestScore = 0

  for (let i = 0; i < pageTexts.length; i++) {
    const text = (pageTexts[i] ?? '').toLowerCase()
    if (!text) continue

    let score = 0
    for (const tok of uniqueTokens) {
      if (text.includes(tok)) score++
    }

    if (score > bestScore) {
      bestScore = score
      bestPage = i
    }
  }

  // Require at least 25% of unique abstract tokens to match, otherwise
  // we don't trust the match.
  const threshold = Math.max(1, Math.ceil(uniqueTokens.length * 0.25))
  if (bestScore < threshold) return null

  return bestPage + 1 // 1-indexed
}

/**
 * Check whether the system has `pdftoppm` available.
 * Cached after first call.
 */
let pdftoppmCache: boolean | null = null
export async function hasPdftoppm(): Promise<boolean> {
  if (pdftoppmCache !== null) return pdftoppmCache
  return new Promise(resolve => {
    const child = spawn('pdftoppm', ['-v'])
    child.on('error', () => {
      pdftoppmCache = false
      resolve(false)
    })
    child.on('exit', () => {
      // pdftoppm -v exits 0 (or 99 depending on version) but it ran.
      pdftoppmCache = true
      resolve(true)
    })
    // Suppress stderr from -v output.
    child.stderr?.on('data', () => {})
    child.stdout?.on('data', () => {})
  })
}

/**
 * Render a specific PDF page to a PNG file using `pdftoppm`.
 *
 *   pdftoppm -png -r <DPI> -f <PAGE> -l <PAGE> <input.pdf> <out-prefix>
 *
 * `pdftoppm` writes <out-prefix>-<page>.png. We rename it to <out-prefix>.png.
 *
 * Returns the path to the rendered PNG, or null if rendering failed.
 */
export async function renderPageWithPdftoppm(
  pdfPath: string,
  pageNumber: number,
  outPath: string,
  dpi: number = SCREENSHOT_DPI
): Promise<string | null> {
  // pdftoppm writes a file with the page number suffix; we'll rename it.
  // Strip extension to form the prefix.
  const ext = extname(outPath)
  const prefix = outPath.slice(0, -ext.length || undefined)

  return new Promise(resolve => {
    const child = spawn('pdftoppm', [
      '-png',
      '-r', String(dpi),
      '-f', String(pageNumber),
      '-l', String(pageNumber),
      pdfPath,
      prefix
    ])

    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })

    child.on('error', err => {
      console.warn(`[pdf] pdftoppm spawn error: ${err.message}`)
      resolve(null)
    })

    child.on('exit', code => {
      if (code !== 0) {
        console.warn(`[pdf] pdftoppm exit ${code}: ${stderr}`)
        resolve(null)
        return
      }
      // pdftoppm names output "<prefix>-NN.png" (zero-padded to the widest
      // page number). Locate it.
      const padded = String(pageNumber).padStart(2, '0')
      const candidates = [
        `${prefix}-${padded}.png`,
        `${prefix}-${pageNumber}.png`,
        `${prefix}-${padded.padStart(3, '0')}.png`
      ]
      for (const c of candidates) {
        if (existsSync(c)) {
          // Rename to the requested final path.
          if (c !== outPath) {
            try {
              if (existsSync(outPath)) unlinkSync(outPath)
              renameSync(c, outPath)
            } catch {
              // If rename fails, just keep the original name.
              resolve(c)
              return
            }
          }
          resolve(outPath)
          return
        }
      }
      console.warn(`[pdf] pdftoppm output not found among ${candidates.join(', ')}`)
      resolve(null)
    })
  })
}

/**
 * Verify the rendered PNG meets the resolution requirement.
 * (We can't actually decode the PNG dimensions without a library, but
 * `pdftoppm -r 200` on US-Letter is always 1700x2200, well above the
 * 1000 px minimum. This function is here for tests and future verification.)
 */
export function _expectedMinShortSide(dpi: number = SCREENSHOT_DPI): number {
  // A4: 8.27" × 11.69"; shortest side = 8.27" → 8.27 * dpi
  // US-Letter: 8.5" × 11"; shortest side = 8.5" → 8.5 * dpi
  // Use A4 (smaller) as the conservative floor.
  return Math.floor(8.27 * dpi)
}

// Test-only: ensure the constant meets the user requirement.
void MIN_SHORT_SIDE_PX
// Verify our DPI choice hits the 1000px floor at A4 shortest side.
if (_expectedMinShortSide() < MIN_SHORT_SIDE_PX) {
  throw new Error(`SCREENSHOT_DPI ${SCREENSHOT_DPI} too low for ${MIN_SHORT_SIDE_PX}px minimum`)
}

/**
 * End-to-end: download PDF, locate abstract, render screenshot.
 *
 * Caller provides the directory where the screenshot should be written.
 * We name it `abstract-page.png` inside that directory.
 *
 *   const result = await processPdf(pub, '/path/to/year/openalex_id', 'rel/path')
 *   // → writes /path/to/year/openalex_id/abstract-page.png
 *
 * Returns metadata describing what happened. Never throws — failures
 * downgrade gracefully (skipped=true) so the rest of the sync still runs.
 */
export async function processPdf(
  work: { abstract: string | null; pdfUrl: string | null },
  outDir: string,
  relativeDir: string
): Promise<PdfProcessResult> {
  if (!work.pdfUrl) {
    return { pdfUrl: null, abstractPage: null, screenshotPath: null, skipped: true, reason: 'no PDF URL' }
  }

  const pdfBuffer = await downloadPdf(work.pdfUrl)
  if (!pdfBuffer) {
    return { pdfUrl: work.pdfUrl, abstractPage: null, screenshotPath: null, skipped: true, reason: 'download failed' }
  }

  let pageTexts: string[] = []
  let abstractPage: number | null = null
  try {
    pageTexts = await extractPageText(pdfBuffer)
    abstractPage = locateAbstractPage(work.abstract, pageTexts)
  } catch (err) {
    console.warn(`[pdf] text extraction failed: ${(err as Error).message}`)
    return { pdfUrl: work.pdfUrl, abstractPage: null, screenshotPath: null, skipped: true, reason: 'text extraction failed' }
  }

  if (!abstractPage) {
    return { pdfUrl: work.pdfUrl, abstractPage: null, screenshotPath: null, skipped: true, reason: 'abstract page not located' }
  }

  // Render screenshot if we can.
  if (!await hasPdftoppm()) {
    console.warn(`[pdf] pdftoppm not installed — skipping screenshot, keeping PDF URL + abstract page`)
    return {
      pdfUrl: work.pdfUrl,
      abstractPage,
      screenshotPath: null,
      skipped: true,
      reason: 'pdftoppm not available'
    }
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const tmpPdfPath = join(outDir, '_source.pdf')
  writeFileSync(tmpPdfPath, pdfBuffer)

  try {
    const outPath = join(outDir, 'abstract-page.png')
    const rendered = await renderPageWithPdftoppm(tmpPdfPath, abstractPage, outPath)
    if (!rendered) {
      return { pdfUrl: work.pdfUrl, abstractPage, screenshotPath: null, skipped: true, reason: 'render failed' }
    }

    return {
      pdfUrl: work.pdfUrl,
      abstractPage,
      screenshotPath: join(relativeDir, 'abstract-page.png'),
      skipped: false
    }
  } finally {
    // Always clean up the source PDF — we don't want to publish it.
    try { unlinkSync(tmpPdfPath) } catch { /* ignore */ }
  }
}
