/**
 * Type definitions for sync-publications action
 */

export interface ExistingPublication {
  /** Absolute path to the publication markdown file. */
  file: string
  openalexId?: string
  doi?: string
  title?: string
  year?: number
  authors?: string[]
  /** Whether the file already has a non-empty `openalex_id` frontmatter field. */
  hasOpenalexId: boolean
  /** Whether the file already has a non-empty `authors_orcid` list. */
  hasAuthorsOrcid: boolean
}

/**
 * Outcome of a backfill attempt on a single existing publication file.
 */
export type BackfillResult =
  | { status: 'complete' }
  | { status: 'no_match'; file: string; reason: string }
  | { status: 'backfilled'; file: string; openalexId?: string; changes: string[] }

export interface PendingPublication {
  openalexId: string
  title: string
  authors: string[]
  authorsOrcid: (string | null)[]
  year: number
  doi: string | null
  venue: string | null
  keywords: string[]
  abstract: string | null
  /** Best-effort open-access PDF URL (canonical, https). */
  pdfUrl: string | null
  /** 1-indexed page number on which the abstract was located. */
  abstractPage: number | null
  /** Relative path (from repo root) to the rendered abstract-page PNG. */
  abstractScreenshot: string | null
  hidden: boolean
}

export interface MemberInfo {
  name: string
  orcid: string
}

export interface OpenAlexWork {
  id: string
  title: string
  publication_year: number
  doi?: string
  authorships?: Authorship[]
  primary_location?: PrimaryLocation
  keywords?: Keyword[]
  abstract_inverted_index?: Record<string, number[]>
  open_access?: OpenAccess
  best_oa_location?: OpenAccessLocation
}

export interface OpenAccess {
  is_oa?: boolean
  oa_url?: string | null
  oa_status?: string | null
}

export interface OpenAccessLocation {
  pdf_url?: string | null
  landing_page_url?: string | null
  is_oa?: boolean
  license?: string | null
  version?: string | null
}

export interface Authorship {
  author?: {
    display_name?: string
    orcid?: string
  }
}

export interface PrimaryLocation {
  source?: {
    display_name?: string
  }
  pdf_url?: string | null
}

export interface Keyword {
  display_name?: string
}

export interface OpenAlexResponse<T> {
  results: T[]
  meta: {
    next_cursor?: string | null
  }
}

/**
 * Options for HTTP fetch with retry/timeout.
 */
export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  signal?: AbortSignal
}

/**
 * Result of PDF processing for a single publication.
 */
export interface PdfProcessResult {
  pdfUrl: string | null
  abstractPage: number | null
  screenshotPath: string | null
  skipped: boolean
  reason?: string
}
