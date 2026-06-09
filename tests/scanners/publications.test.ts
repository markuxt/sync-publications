import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanExistingPublications } from '../../src/scanners/publications.js'

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `pubs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('scanExistingPublications', () => {
  it('returns an empty list when directory has no markdown files', async () => {
    expect(await scanExistingPublications(dir)).toEqual([])
  })

  it('extracts openalex_id, doi, title, year, authors from frontmatter', async () => {
    mkdirSync(join(dir, '2024', 'W1'), { recursive: true })
    writeFileSync(
      join(dir, '2024', 'W1', 'index.md'),
      `---
_hidden: false
title: A Study of Robots
authors:
  - Doe, John
year: 2024
doi: https://doi.org/10.1000/foo
openalex_id: W1
venue: ICRA
---

Body text here.
`)
    const pubs = await scanExistingPublications(dir)
    expect(pubs).toHaveLength(1)
    expect(pubs[0]).toEqual({
      file: expect.any(String),
      openalexId: '1', // leading W stripped
      doi: '10.1000/foo', // normalised
      title: 'A Study of Robots',
      year: 2024,
      authors: ['Doe, John'],
      hasOpenalexId: true,
      hasAuthorsOrcid: false
    })
  })

  it('skips hidden publications', async () => {
    mkdirSync(join(dir, '2024', 'W1'), { recursive: true })
    writeFileSync(
      join(dir, '2024', 'W1', 'index.md'),
      '---\n_hidden: true\ntitle: T\nyear: 2024\n---\n'
    )
    expect(await scanExistingPublications(dir)).toEqual([])
  })

  it('handles year stored as number or string', async () => {
    mkdirSync(join(dir, '2024', 'W1'), { recursive: true })
    mkdirSync(join(dir, '2023', 'W2'), { recursive: true })
    writeFileSync(join(dir, '2024', 'W1', 'index.md'), '---\nopenalex_id: W1\ntitle: T\nyear: 2024\n---\n')
    writeFileSync(join(dir, '2023', 'W2', 'index.md'), '---\nopenalex_id: W2\ntitle: T2\nyear: "2023"\n---\n')
    const pubs = await scanExistingPublications(dir)
    expect(pubs.find(p => p.openalexId === '1')?.year).toBe(2024)
    expect(pubs.find(p => p.openalexId === '2')?.year).toBe(2023)
  })

  it('parses empty/missing DOI as undefined', async () => {
    mkdirSync(join(dir, '2024', 'W1'), { recursive: true })
    writeFileSync(join(dir, '2024', 'W1', 'index.md'), '---\ntitle: T\nyear: 2024\ndoi:\n---\n')
    const pubs = await scanExistingPublications(dir)
    expect(pubs[0].doi).toBeUndefined()
  })
})
