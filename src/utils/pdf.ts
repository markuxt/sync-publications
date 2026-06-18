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
import { fetchWithRetry } from './http'
import type { OpenAlexWork, PdfProcessResult } from '../types'

const SCREENSHOT_DPI = 200
const MIN_SHORT_SIDE_PX = 1000
const MAX_PDF_BYTES = 50 * 1024 * 1024 // 50 MB hard cap

/**
 * Browser-like User-Agent for PDF downloads. Many OA hosts (publisher sites,
 * institutional repositories such as Wiley / Elsevier / worktribe) reject
 * requests carrying undici's default UA with 403/405; a desktop-browser UA
 * unblocks most of them.
 */
const PDF_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Collect every candidate OA PDF URL from an OpenAlex work, in priority order,
 * de-duplicated. We try them in turn until one downloads as a real PDF.
 *
 * Only the `*_pdf_url` fields point at the actual PDF: best_oa_location → every
 * entry in locations[] → primary_location. `open_access.oa_url` is deliberately
 * excluded — it is a landing page (very often a doi.org resolver), never the
 * PDF itself. Any doi.org URL is rejected for the same reason. Many works have
 * several OA copies (repository, preprint server, …); the "best" one is often a
 * host that 403s us, so falling through to the alternates recovers screenshots.
 */
export function pickPdfUrls(work: OpenAlexWork): string[] {
  const candidates: (string | null | undefined)[] = []
  candidates.push(work.best_oa_location?.pdf_url)
  for (const loc of work.locations ?? []) candidates.push(loc?.pdf_url)
  candidates.push(work.primary_location?.pdf_url)

  const seen = new Set<string>()
  const out: string[] = []
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue
    if (!/^https?:\/\//i.test(c)) continue
    // A DOI resolver never serves a PDF (it redirects to the publisher page).
    if (/^https?:\/\/(dx\.)?doi\.org\//i.test(c)) continue
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

/**
 * Canonical (first) candidate URL. Kept for callers/tests that want a single
 * URL; the download path uses pickPdfUrls to try alternates on failure.
 */
export function pickPdfUrl(work: OpenAlexWork): string | null {
  return pickPdfUrls(work)[0] ?? null
}

/**
 * Download a PDF into a buffer. Enforces a size cap and a sensible timeout.
 * Returns null if the URL is unreachable or the response isn't a PDF.
 */
export async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetchWithRetry(url, {
      timeoutMs: 60_000,
      retries: 2,
      headers: {
        'User-Agent': PDF_USER_AGENT,
        'Accept': 'application/pdf,application/octet-stream,*/*'
      }
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
 * where `text[i]` is the full text of page i+1. unpdf requires the input
 * to be a Uint8Array (not a Node Buffer).
 */
export async function extractPageText(pdfBuffer: Buffer): Promise<string[]> {
  const { text } = await extractText(new Uint8Array(pdfBuffer), { mergePages: false })
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
 * Caller provides the directory where the screenshot should be written (the
 * publication's own directory) and the file basename (without extension). The
 * PNG is written to `<outDir>/<name>.png` and `screenshotPath` is returned as
 * the bare `<name>.png` — markuxt resolves it relative to the publication's
 * location (like member photos), NOT as a repo-root path.
 *
 *   const result = await processPdf(pub, 'publications/2024', 'W123')
 *   // → writes publications/2024/W123.png, screenshotPath = 'W123.png'
 *
 * Returns metadata describing what happened. Never throws — failures
 * downgrade gracefully (skipped=true) so the rest of the sync still runs.
 */
export async function processPdf(
  work: { abstract: string | null; pdfUrl: string | null; pdfUrls?: string[] },
  outDir: string,
  name: string = 'abstract-page'
): Promise<PdfProcessResult> {
  // Candidate URLs: prefer the full list; fall back to the single canonical one.
  const urls = work.pdfUrls && work.pdfUrls.length
    ? work.pdfUrls
    : (work.pdfUrl ? [work.pdfUrl] : [])

  if (!urls.length) {
    return { pdfUrl: null, abstractPage: null, screenshotPath: null, skipped: true, reason: 'no PDF URL' }
  }

  // Try each candidate until one downloads as a real PDF. Many works have
  // several OA copies; the first is often a paywalled landing page or a host
  // that 403s us, so we fall through to the alternates.
  let pdfBuffer: Buffer | null = null
  let usedUrl = urls[0]
  for (const url of urls) {
    pdfBuffer = await downloadPdf(url)
    if (pdfBuffer) {
      usedUrl = url
      break
    }
  }
  if (!pdfBuffer) {
    return { pdfUrl: usedUrl, abstractPage: null, screenshotPath: null, skipped: true, reason: 'download failed' }
  }

  let pageTexts: string[] = []
  let abstractPage: number | null = null
  try {
    pageTexts = await extractPageText(pdfBuffer)
    abstractPage = locateAbstractPage(work.abstract, pageTexts)
  } catch (err) {
    console.warn(`[pdf] text extraction failed: ${(err as Error).message}`)
    return { pdfUrl: usedUrl, abstractPage: null, screenshotPath: null, skipped: true, reason: 'text extraction failed' }
  }

  if (!abstractPage) {
    return { pdfUrl: usedUrl, abstractPage: null, screenshotPath: null, skipped: true, reason: 'abstract page not located' }
  }

  // Render screenshot if we can.
  if (!await hasPdftoppm()) {
    console.warn(`[pdf] pdftoppm not installed — skipping screenshot, keeping PDF URL + abstract page`)
    return {
      pdfUrl: usedUrl,
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
    const outPath = join(outDir, `${name}.png`)
    const rendered = await renderPageWithPdftoppm(tmpPdfPath, abstractPage, outPath)
    if (!rendered) {
      return { pdfUrl: usedUrl, abstractPage, screenshotPath: null, skipped: true, reason: 'render failed' }
    }

    return {
      pdfUrl: usedUrl,
      abstractPage,
      screenshotPath: `${name}.png`,
      skipped: false
    }
  } finally {
    // Always clean up the source PDF — we don't want to publish it.
    try { unlinkSync(tmpPdfPath) } catch { /* ignore */ }
  }
}
