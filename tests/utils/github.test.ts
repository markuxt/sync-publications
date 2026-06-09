import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { initGitHubOutput, setOutput, _resetGitHubOutputPath } from '../../src/utils/github.js'
import { tmpdir } from 'os'

let outPath: string

beforeEach(() => {
  outPath = join(tmpdir(), `gh-out-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  _resetGitHubOutputPath()
})

afterEach(() => {
  if (existsSync(outPath)) unlinkSync(outPath)
})

describe('setOutput (no path = local mode)', () => {
  it('does nothing when no GITHUB_OUTPUT path has been initialised', () => {
    initGitHubOutput('')
    setOutput('foo', 'bar')
    // No file should exist; no throw.
    expect(existsSync(outPath)).toBe(false)
  })
})

describe('setOutput (single-line value)', () => {
  it('writes name=value\\n for single-line values', () => {
    initGitHubOutput(outPath)
    setOutput('count', '5')
    const content = readFileSync(outPath, 'utf-8')
    expect(content).toBe('count=5\n')
  })
})

describe('setOutput (multi-line value)', () => {
  it('uses heredoc delimiter so multi-line values are not truncated', () => {
    // Code-review #4: the previous `name=value\n` format caused only the
    // first line to be picked up by the runner.
    initGitHubOutput(outPath)
    setOutput('files', 'a/b.md\nc/d.md\ne/f.md')

    const content = readFileSync(outPath, 'utf-8')
    // Expected format:
    //   files<<EOF_MARKUXT_SYNC_PUBLICATIONS
    //   a/b.md
    //   c/d.md
    //   e/f.md
    //   EOF_MARKUXT_SYNC_PUBLICATIONS
    expect(content).toMatch(/^files<<EOF_MARKUXT_SYNC_PUBLICATIONS\n/)
    expect(content).toMatch(/\nEOF_MARKUXT_SYNC_PUBLICATIONS\n$/)
    expect(content).toContain('a/b.md')
    expect(content).toContain('c/d.md')
    expect(content).toContain('e/f.md')
  })
})
