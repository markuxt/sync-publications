import { describe, it, expect } from 'vitest'
import { filterDuplicates, deduplicatePending } from '../../src/workers/deduplicator'
import type { PendingPublication, ExistingPublication } from '../../src/types'

function makePub(overrides: Partial<PendingPublication>): PendingPublication {
  return {
    openalexId: 'W1',
    title: 'A Paper',
    authors: ['Doe, J'],
    authorsOrcid: [null],
    year: 2024,
    doi: null,
    venue: null,
    keywords: [],
    abstract: null,
    pdfUrl: null,
    pdfUrls: [],
    abstractPage: null,
    abstractScreenshot: null,
    hidden: false,
    ...overrides
  }
}

function makeExisting(overrides: Partial<ExistingPublication>): ExistingPublication {
  return {
    file: '/tmp/test.md',
    hasOpenalexId: false,
    hasAuthorsOrcid: false,
    ...overrides
  }
}

describe('filterDuplicates', () => {
  it('returns the pending publication when no existing matches', () => {
    const pending = new Map([['W1', makePub({ openalexId: 'W1' })]])
    const result = filterDuplicates(pending, [], new Set(), new Set())
    expect(result).toHaveLength(1)
    expect(result[0].openalexId).toBe('W1')
  })

  it('skips when OpenAlex ID matches existing', () => {
    const pending = new Map([['W1', makePub({ openalexId: 'W1' })]])
    const existing: ExistingPublication[] = [makeExisting({ openalexId: '1' })]
    const result = filterDuplicates(pending, existing, new Set(['1']), new Set())
    expect(result).toHaveLength(0)
  })

  it('skips when DOI matches existing (normalised)', () => {
    const pending = new Map([['W1', makePub({ openalexId: 'W1', doi: 'https://doi.org/10.1000/foo' })]])
    const existing: ExistingPublication[] = [makeExisting({ doi: '10.1000/foo' })]
    const result = filterDuplicates(pending, existing, new Set(), new Set(['10.1000/foo']))
    expect(result).toHaveLength(0)
  })

  it('skips when title is similar and authors overlap', () => {
    // Tokens: {deep, reinforcement, learning, approach, robotic, manipulation, tasks}
    // vs the same plus {extended}. intersection=7, union=8 → 0.875 ≥ 0.85.
    const pending = new Map([['W2', makePub({
      openalexId: 'W2',
      title: 'Deep Reinforcement Learning Approach Robotic Manipulation Tasks',
      authors: ['Doe, J', 'Smith, A'],
      year: 2024
    })]])
    const existing: ExistingPublication[] = [makeExisting({
      title: 'Deep Reinforcement Learning Approach Robotic Manipulation Tasks Extended',
      year: 2024,
      authors: ['Doe, J', 'Smith, A']
    })]
    const result = filterDuplicates(pending, existing, new Set(), new Set())
    expect(result).toHaveLength(0)
  })

  it('keeps publications with different titles + authors', () => {
    const pending = new Map([['W1', makePub({
      openalexId: 'W1',
      title: 'Astronomy of the Andromeda Galaxy',
      authors: ['Doe, J'],
      year: 2024
    })]])
    const existing: ExistingPublication[] = [makeExisting({
      title: 'Recipe Development for French Pastry',
      year: 2024,
      authors: ['Smith, A']
    })]
    const result = filterDuplicates(pending, existing, new Set(), new Set())
    expect(result).toHaveLength(1)
  })
})

describe('deduplicatePending', () => {
  it('returns all entries with hidden=false when no duplicates exist', () => {
    const pubs = [
      makePub({ openalexId: 'W1', title: 'Astronomy of the Andromeda Galaxy' }),
      makePub({ openalexId: 'W2', title: 'Recipe Development for French Pastry' })
    ]
    const result = deduplicatePending(pubs)
    expect(result).toHaveLength(2)
    expect(result.every(p => !p.hidden)).toBe(true)
  })

  it('hides older versions of the same publication (by DOI)', () => {
    const pubs = [
      makePub({ openalexId: 'W1', title: 'Paper A', year: 2020, doi: 'https://doi.org/10.1000/foo' }),
      makePub({ openalexId: 'W2', title: 'Paper A', year: 2024, doi: 'https://doi.org/10.1000/foo' })
    ]
    const result = deduplicatePending(pubs)
    expect(result).toHaveLength(2)
    const visible = result.find(p => !p.hidden)!
    const hidden = result.find(p => p.hidden)!
    expect(visible.year).toBe(2024)
    expect(hidden.year).toBe(2020)
  })

  it('hides older versions of the same publication (by exact title)', () => {
    const pubs = [
      makePub({ openalexId: 'W1', title: 'Same Title', year: 2024 }),
      makePub({ openalexId: 'W2', title: 'Same Title', year: 2022 })
    ]
    const result = deduplicatePending(pubs)
    expect(result.find(p => p.year === 2024)!.hidden).toBe(false)
    expect(result.find(p => p.year === 2022)!.hidden).toBe(true)
  })

  it('groups 3+ duplicates together, hiding all but the newest', () => {
    const pubs = [
      makePub({ openalexId: 'W1', title: 'T', year: 2018, doi: 'https://doi.org/10.1000/x' }),
      makePub({ openalexId: 'W2', title: 'T', year: 2020, doi: 'https://doi.org/10.1000/x' }),
      makePub({ openalexId: 'W3', title: 'T', year: 2024, doi: 'https://doi.org/10.1000/x' })
    ]
    const result = deduplicatePending(pubs)
    expect(result).toHaveLength(3)
    expect(result.find(p => !p.hidden)!.year).toBe(2024)
    expect(result.filter(p => p.hidden)).toHaveLength(2)
  })

  it('treats DOIs with mixed-case / resolver variants as equivalent', () => {
    const pubs = [
      makePub({ openalexId: 'W1', title: 'A', year: 2020, doi: 'https://doi.org/10.1000/foo' }),
      makePub({ openalexId: 'W2', title: 'A', year: 2024, doi: 'https://dx.doi.org/10.1000/FOO' })
    ]
    const result = deduplicatePending(pubs)
    expect(result.find(p => !p.hidden)!.year).toBe(2024)
  })
})
