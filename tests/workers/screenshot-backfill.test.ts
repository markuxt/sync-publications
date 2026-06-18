import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { backfillScreenshots } from '../../src/workers/screenshot-backfill'
import type { ExistingPublication } from '../../src/types'

describe('backfillScreenshots', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sb-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  function pub(name: string, fm: Record<string, string>, openalexId?: string): ExistingPublication {
    const file = join(dir, name)
    const fmText = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')
    writeFileSync(file, `---\n${fmText}\n---\n\nReconstructed abstract body text.\n`)
    return { file, hasOpenalexId: !!openalexId, hasAuthorsOrcid: false, openalexId }
  }

  // Skip paths only — the re-query/download path needs a live PDF + pdftoppm
  // and is exercised by the integration run, not here.

  it('skips publications that already have an abstract_screenshot', async () => {
    const e = pub('a.md', { abstract_screenshot: 'a.png' }, 'W1')
    expect(await backfillScreenshots([e], 'test@example.com')).toEqual([])
  })

  it('skips publications without an openalex_id (cannot re-query)', async () => {
    const e = pub('b.md', {}) // no openalex_id, no screenshot
    expect(await backfillScreenshots([e], 'test@example.com')).toEqual([])
  })
})
