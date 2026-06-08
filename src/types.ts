/**
 * Type definitions for sync-publications action
 */

export interface ExistingPublication {
  openalexId?: string
  doi?: string
  title?: string
  year?: number
  authors?: string[]
}

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
