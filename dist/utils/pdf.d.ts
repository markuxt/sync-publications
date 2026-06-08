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
import type { OpenAlexWork, PdfProcessResult } from '../types.js';
/**
 * Pick the best PDF URL from an OpenAlex work object.
 * Priority: best_oa_location.pdf_url > primary_location.pdf_url
 * > open_access.oa_url (only if it looks like a PDF).
 */
export declare function pickPdfUrl(work: OpenAlexWork): string | null;
/**
 * Download a PDF into a buffer. Enforces a size cap and a sensible timeout.
 * Returns null if the URL is unreachable or the response isn't a PDF.
 */
export declare function downloadPdf(url: string): Promise<Buffer | null>;
/**
 * Per-page text extraction. Returns an array indexed (0-based) per page.
 *
 * `unpdf.extractText` with `mergePages: false` returns `{ totalPages, text: string[] }`
 * where `text[i]` is the full text of page i+1.
 */
export declare function extractPageText(pdfBuffer: Buffer): Promise<string[]>;
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
export declare function locateAbstractPage(abstract: string | null, pageTexts: string[]): number | null;
export declare function hasPdftoppm(): Promise<boolean>;
/**
 * Render a specific PDF page to a PNG file using `pdftoppm`.
 *
 *   pdftoppm -png -r <DPI> -f <PAGE> -l <PAGE> <input.pdf> <out-prefix>
 *
 * `pdftoppm` writes <out-prefix>-<page>.png. We rename it to <out-prefix>.png.
 *
 * Returns the path to the rendered PNG, or null if rendering failed.
 */
export declare function renderPageWithPdftoppm(pdfPath: string, pageNumber: number, outPath: string, dpi?: number): Promise<string | null>;
/**
 * Verify the rendered PNG meets the resolution requirement.
 * (We can't actually decode the PNG dimensions without a library, but
 * `pdftoppm -r 200` on US-Letter is always 1700x2200, well above the
 * 1000 px minimum. This function is here for tests and future verification.)
 */
export declare function _expectedMinShortSide(dpi?: number): number;
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
export declare function processPdf(work: {
    abstract: string | null;
    pdfUrl: string | null;
}, outDir: string, relativeDir: string): Promise<PdfProcessResult>;
//# sourceMappingURL=pdf.d.ts.map