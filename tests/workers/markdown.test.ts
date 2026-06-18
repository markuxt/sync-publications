import { describe, it, expect } from 'vitest'
import { buildMarkdown } from '../../src/workers/markdown'
import type { PendingPublication } from '../../src/types'

const pub = (overrides: Partial<PendingPublication> = {}): PendingPublication => ({
  openalexId: 'W123',
  title: 'A Paper',
  authors: ['Doe, John'],
  authorsOrcid: ['0000-0001-2345-6789'],
  year: 2024,
  doi: 'https://doi.org/10.1000/x',
  venue: 'Conf 2024',
  keywords: ['robotics'],
  abstract: 'The reconstructed abstract body.',
  pdfUrl: 'https://example.com/p.pdf',     // internal — must NOT be emitted
  pdfUrls: ['https://example.com/p.pdf'],
  abstractPage: 1,                          // internal — must NOT be emitted
  abstractScreenshot: 'a-paper.png',
  hidden: false,
  ...overrides,
})

describe('buildMarkdown', () => {
  it('emits the publication frontmatter + abstract body', () => {
    const md = buildMarkdown(pub())
    expect(md).toContain('title: A Paper')
    expect(md).toContain('openalex_id: W123')
    expect(md).toContain('doi: https://doi.org/10.1000/x')
    expect(md).toContain('abstract_screenshot: a-paper.png')
    expect(md).toContain('The reconstructed abstract body.')
  })

  it('does NOT emit pdf_url / abstract_page (internal download details)', () => {
    const md = buildMarkdown(pub()) // pub has pdfUrl + abstractPage set
    expect(md).not.toContain('pdf_url:')
    expect(md).not.toContain('abstract_page:')
  })

  it('emits keywords: [] when there are none', () => {
    expect(buildMarkdown(pub({ keywords: [] }))).toContain('keywords: []')
  })

  it('omits the abstract line when there is none', () => {
    const md = buildMarkdown(pub({ abstract: null }))
    expect(md).not.toContain('abstract body')
  })
})
