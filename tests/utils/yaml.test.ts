import { describe, it, expect } from 'vitest'
import { parseYamlFrontmatter, yamlStr, updateFrontmatter } from '../../src/utils/yaml'

describe('parseYamlFrontmatter', () => {
  it('returns an empty object when there is no frontmatter', () => {
    expect(parseYamlFrontmatter('Hello world')).toEqual({})
  })

  it('parses simple key:value pairs', () => {
    const md = '---\nname: John\nyear: 2024\n---\nbody'
    expect(parseYamlFrontmatter(md)).toEqual({ name: 'John', year: 2024 })
  })

  it('parses list values (block style)', () => {
    const md = '---\nkeywords:\n  - robotics\n  - control\n---\n'
    expect(parseYamlFrontmatter(md)).toEqual({ keywords: ['robotics', 'control'] })
  })

  it('parses inline arrays', () => {
    // Code-review #9: the old parser only knew `  - foo` lists. Real YAML
    // also supports [foo, bar] syntax.
    const md = '---\nkeywords: [robotics, control]\n---\n'
    expect(parseYamlFrontmatter(md)).toEqual({ keywords: ['robotics', 'control'] })
  })

  it('parses booleans / numbers as their real types', () => {
    // Code-review #9: the old parser only returned strings.
    const md = '---\n_hidden: true\ncount: 7\n---\n'
    expect(parseYamlFrontmatter(md)).toEqual({ _hidden: true, count: 7 })
  })

  it('handles CRLF line endings', () => {
    const md = '---\r\nname: John\r\nyear: 2024\r\n---\r\nbody'
    expect(parseYamlFrontmatter(md)).toEqual({ name: 'John', year: 2024 })
  })

  it('handles values containing colons', () => {
    const md = '---\ndoi: https://doi.org/10.1000/foo\n---\n'
    expect(parseYamlFrontmatter(md)).toEqual({ doi: 'https://doi.org/10.1000/foo' })
  })
})

describe('yamlStr', () => {
  it('returns plain scalars unchanged when no special chars', () => {
    expect(yamlStr('hello')).toBe('hello')
  })

  it('emits valid (parseable) YAML for URLs even when not quoted', () => {
    // Plain URL is valid as a YAML scalar (no quoting needed) as long as
    // parseYamlFrontmatter round-trips it back to the same string.
    const out = yamlStr('https://doi.org/10.1000/foo')
    // Should parse back to the original value via the same yaml library.
    const { parse: yamlParse } = require('yaml')
    expect(yamlParse(`${out}`)).toBe('https://doi.org/10.1000/foo')
  })

  it('quotes values with leading/trailing whitespace', () => {
    expect(yamlStr(' padded ').startsWith('"') || yamlStr(' padded ').startsWith("'")).toBe(true)
  })

  it('handles empty string', () => {
    // We special-case empty to emit '' so `field: ${yamlStr(value)}` produces
    // a clean `field: ` instead of `field: ""`.
    expect(yamlStr('')).toBe('')
  })

  it('collapses embedded line breaks so inline frontmatter stays valid', () => {
    expect(yamlStr('Line one\nLine two')).toBe('Line one Line two')
  })

  it('does not wrap long quoted scalars across lines (re-scan idempotency)', () => {
    // A long title containing ": " gets quoted; it must NOT be folded across
    // lines, or emitting it inline as `title: …` puts the continuation at
    // column 0 → invalid YAML that parseYamlFrontmatter rejects on re-scan.
    const title = 'Generating precise non-flat grinding wheel surfaces via CO2 laser ablation: Understanding the relationship between overlap rate and feed rate on composite materials'
    const scalar = yamlStr(title)
    expect(scalar.includes('\n')).toBe(false)
    const md = `---\ntitle: ${scalar}\nyear: 2022\n---`
    expect(parseYamlFrontmatter(md)).toEqual({ title, year: 2022 })
  })
})

describe('updateFrontmatter', () => {
  it('returns content unchanged when there is no frontmatter', () => {
    const md = 'No frontmatter here.'
    expect(updateFrontmatter(md, { openalex_id: 'W1' })).toBe(md)
  })

  it('appends a new scalar field and preserves existing keys + body', () => {
    const md = '---\ntitle: My Paper\nyear: 2024\n---\n\nAbstract body.\n'
    const out = updateFrontmatter(md, { openalex_id: 'W123' })
    expect(parseYamlFrontmatter(out)).toMatchObject({
      title: 'My Paper', year: 2024, openalex_id: 'W123'
    })
    expect(out.endsWith('---\n\nAbstract body.\n')).toBe(true)
  })

  it('appends a list with null entries (authors_orcid)', () => {
    const md = '---\ntitle: T\nauthors:\n  - Doe, John\n  - Roe, Jane\n---\n\nbody\n'
    const out = updateFrontmatter(md, { authors_orcid: ['0000-0001-2345-6789', null] })
    const fm = parseYamlFrontmatter(out)
    expect(fm.authors_orcid).toEqual(['0000-0001-2345-6789', null])
    expect(fm.authors).toEqual(['Doe, John', 'Roe, Jane'])
  })

  it('preserves the body exactly when it has no trailing newline', () => {
    const md = '---\ntitle: T\n---\nbody without newline'
    const out = updateFrontmatter(md, { openalex_id: 'W1' })
    expect(out.endsWith('---\nbody without newline')).toBe(true)
  })

  it('preserves CRLF line endings in the frontmatter', () => {
    const md = '---\r\ntitle: T\r\nyear: 2024\r\n---\r\n\r\nbody\r\n'
    const out = updateFrontmatter(md, { openalex_id: 'W1' })
    expect(out).toContain('\r\nopenalex_id: W1\r\n')
    expect(out.endsWith('---\r\n\r\nbody\r\n')).toBe(true)
  })

  it('does not wrap long scalar lines (lineWidth: 0)', () => {
    const longTitle = 'A Very Long Title That Would Normally Wrap At Eighty Characters If Wrapping Were Enabled'
    const md = `---\ntitle: ${longTitle}\n---\n\nbody\n`
    const out = updateFrontmatter(md, { openalex_id: 'W1' })
    expect(out.includes(`title: ${longTitle}\n`)).toBe(true)
  })

  it('updates an existing field value in place', () => {
    const md = '---\nopenalex_id: OLD\nyear: 2024\n---\n\nbody\n'
    const out = updateFrontmatter(md, { openalex_id: 'W999' })
    const fm = parseYamlFrontmatter(out)
    expect(fm.openalex_id).toBe('W999')
    expect(fm.year).toBe(2024)
  })
})
