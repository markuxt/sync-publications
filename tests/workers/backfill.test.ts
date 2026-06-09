import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildAuthorsOrcid,
  backfillPublication,
  backfillExisting
} from '../../src/workers/backfill.js'
import { parseYamlFrontmatter } from '../../src/utils/yaml.js'
import type { ExistingPublication, OpenAlexWork } from '../../src/types.js'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function mockJsonFetch(responses: Array<{ status?: number; body: unknown }>): ReturnType<typeof vi.fn> {
  let i = 0
  const mock = vi.fn(async () => {
    const next = responses[i++] ?? responses[responses.length - 1]
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' }
    })
  })
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

function makeWork(over: Partial<OpenAlexWork> = {}): OpenAlexWork {
  return {
    id: 'https://openalex.org/W123',
    title: 'A Study of Robots',
    publication_year: 2024,
    doi: 'https://doi.org/10.1000/foo',
    authorships: [
      { author: { display_name: 'John Doe', orcid: 'https://orcid.org/0000-0001-2345-6789' } },
      { author: { display_name: 'Jane Roe', orcid: null } }
    ],
    ...over
  }
}

describe('buildAuthorsOrcid', () => {
  it('maps each existing author to an ORCID by name, null when unknown', () => {
    const out = buildAuthorsOrcid(['Doe, John', 'Roe, Jane', 'Smith, Bob'], makeWork())
    expect(out).toEqual(['0000-0001-2345-6789', null, null])
  })

  it('matches case-insensitively on the formatted name', () => {
    const out = buildAuthorsOrcid(['doe, john'], makeWork())
    expect(out).toEqual(['0000-0001-2345-6789'])
  })

  it('returns a parallel-length list even when no authors match', () => {
    const out = buildAuthorsOrcid(['Nobody, Here'], makeWork())
    expect(out).toEqual([null])
  })
})

describe('backfillPublication', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = join(tmpdir(), `backfill-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'pub.md')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writePub(fm: string, body = '\n\nAbstract text.\n') {
    writeFileSync(file, `---\n${fm}\n---${body}`)
  }

  it('is a no-op when both fields are already present', async () => {
    writePub([
      'title: T',
      'authors:',
      '  - Doe, John',
      'authors_orcid:',
      '  - 0000-0001-2345-6789',
      'openalex_id: W1',
      'year: 2024',
      'doi: https://doi.org/10.1000/foo'
    ].join('\n'))
    const before = readFileSync(file, 'utf-8')

    const result = await backfillPublication(file, 'me@example.com')

    expect(result.status).toBe('complete')
    expect(readFileSync(file, 'utf-8')).toBe(before)
  })

  it('fills openalex_id + authors_orcid from a DOI lookup, body preserved', async () => {
    writePub([
      'title: A Study of Robots',
      'authors:',
      '  - Doe, John',
      '  - Roe, Jane',
      'year: 2024',
      'doi: https://doi.org/10.1000/foo'
    ].join('\n'))
    mockJsonFetch([{ body: { results: [makeWork()], meta: {} } }])

    const result = await backfillPublication(file, 'me@example.com')

    expect(result.status).toBe('backfilled')
    if (result.status === 'backfilled') {
      expect(result.changes).toEqual(expect.arrayContaining(['openalex_id', 'authors_orcid']))
      expect(result.openalexId).toBe('W123')
    }
    const fm = parseYamlFrontmatter(readFileSync(file, 'utf-8'))
    expect(fm.openalex_id).toBe('W123')
    expect(fm.authors_orcid).toEqual(['0000-0001-2345-6789', null])
    expect(readFileSync(file, 'utf-8').endsWith('---\n\nAbstract text.\n')).toBe(true)
  })

  it('derives authors + authors_orcid from the work when authors is also missing', async () => {
    writePub('title: A Study of Robots\nyear: 2024\ndoi: https://doi.org/10.1000/foo')
    mockJsonFetch([{ body: { results: [makeWork()], meta: {} } }])

    const result = await backfillPublication(file, 'me@example.com')

    expect(result.status).toBe('backfilled')
    const fm = parseYamlFrontmatter(readFileSync(file, 'utf-8'))
    expect(fm.openalex_id).toBe('W123')
    expect(fm.authors).toEqual(['Doe, John', 'Roe, Jane'])
    expect(fm.authors_orcid).toEqual(['0000-0001-2345-6789', null])
  })

  it('rejects a fuzzy title-search match below the similarity guard (no write)', async () => {
    // No DOI, no openalex_id → title+year search path. The found work's title
    // is totally different, so the Jaccard guard must reject it.
    writePub('title: Something Completely Different\nauthors:\n  - Stranger, Alan\nyear: 2024')
    mockJsonFetch([{ body: { results: [makeWork({ title: 'Quantum Entanglement Survey' })], meta: {} } }])

    const before = readFileSync(file, 'utf-8')
    const result = await backfillPublication(file, 'me@example.com')

    expect(result.status).toBe('no_match')
    expect(readFileSync(file, 'utf-8')).toBe(before)
  })

  it('returns no_match when OpenAlex has no result', async () => {
    writePub('title: T\nauthors:\n  - Doe, John\nyear: 2024\ndoi: https://doi.org/10.1000/missing')
    mockJsonFetch([{ body: { results: [], meta: {} } }])

    const result = await backfillPublication(file, 'me@example.com')

    expect(result.status).toBe('no_match')
  })

  it('returns no_match for a file with no frontmatter', async () => {
    writeFileSync(file, 'just body, no frontmatter')

    const result = await backfillPublication(file, 'me@example.com')

    expect(result.status).toBe('no_match')
  })
})

describe('backfillExisting', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `bf-existing-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('only processes incomplete entries and mutates openalexId in place', async () => {
    const file = join(dir, 'pub.md')
    writeFileSync(file, [
      '---',
      'title: A Study of Robots',
      'authors:',
      '  - Doe, John',
      'year: 2024',
      'doi: https://doi.org/10.1000/foo',
      '---',
      '',
      'body',
      ''
    ].join('\n'))
    mockJsonFetch([{ body: { results: [makeWork()], meta: {} } }])

    const existing: ExistingPublication[] = [
      {
        file,
        openalexId: undefined,
        doi: '10.1000/foo',
        title: 'A Study of Robots',
        year: 2024,
        authors: ['Doe, John'],
        hasOpenalexId: false,
        hasAuthorsOrcid: false
      }
    ]

    const changed = await backfillExisting(existing, 'me@example.com')

    expect(changed).toEqual([file])
    expect(existing[0].openalexId).toBe('123') // W stripped for dedup
  })

  it('skips entries that are already complete', async () => {
    const file = join(dir, 'pub.md')
    const existing: ExistingPublication[] = [
      {
        file,
        openalexId: '1',
        doi: '10.1000/foo',
        title: 'T',
        year: 2024,
        authors: ['Doe, John'],
        hasOpenalexId: true,
        hasAuthorsOrcid: true
      }
    ]

    const changed = await backfillExisting(existing, 'me@example.com')

    expect(changed).toEqual([])
  })
})
