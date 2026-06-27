import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanMembersWithOrcid, _internal } from '../../src/scanners/members'

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `members-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isValidOrcid', () => {
  it('accepts a valid ORCID with proper checksum', () => {
    // 0000-0001-2345-6789: ISO 7064 11-2 checksum is 9.
    expect(_internal.isValidOrcid('0000-0001-2345-6789')).toBe(true)
  })

  it('accepts a valid ORCID with X check digit', () => {
    // Compute a valid ORCID with X check digit.
    // 0000-0001-2345-67? — the check digit is whatever (12 - total%11) % 11
    // gives 10 (X). One such pair: 0000-0001-2345-67X (verified below).
    // We compute it programmatically so the test is self-verifying:
    const digits = '00000001234567'  // 14 chars; we'll add a 15th + check
    // Find a digit d (15th position) such that the check digit ends up X
    function checkDigitFor(prefix15: string): string {
      let total = 0
      for (let i = 0; i < prefix15.length; i++) {
        total = (total + Number(prefix15[i])) * 2
      }
      const remainder = total % 11
      const result = (12 - remainder) % 11
      return result === 10 ? 'X' : String(result)
    }
    let found: string | null = null
    for (let d = 0; d <= 9; d++) {
      const candidate = digits + d
      if (checkDigitFor(candidate) === 'X') {
        found = candidate
        break
      }
    }
    expect(found).not.toBeNull()
    const orcid = `${found!.slice(0, 4)}-${found!.slice(4, 8)}-${found!.slice(8, 12)}-${found!.slice(12)}X`
    expect(_internal.isValidOrcid(orcid)).toBe(true)
  })

  it('rejects wrong-format strings', () => {
    expect(_internal.isValidOrcid('not-an-orcid')).toBe(false)
    expect(_internal.isValidOrcid('0000-0001-2345')).toBe(false) // too short
    expect(_internal.isValidOrcid('0000-0001-2345-678Y')).toBe(false) // invalid check char
  })

  it('rejects bad checksum', () => {
    // Last digit computed incorrectly
    expect(_internal.isValidOrcid('0000-0001-2345-6780')).toBe(false)
  })
})

describe('scanMembersWithOrcid', () => {
  it('returns an empty list when directory has no markdown files', async () => {
    expect(await scanMembersWithOrcid(dir)).toEqual([])
  })

  it('returns members with valid ORCID in frontmatter', async () => {
    writeFileSync(
      join(dir, 'alice.md'),
      '---\nname: Alice\norcid: 0000-0001-2345-6789\n---\nbody'
    )
    const members = await scanMembersWithOrcid(dir)
    expect(members).toHaveLength(1)
    expect(members[0]).toEqual({ name: 'Alice', orcid: '0000-0001-2345-6789' })
  })

  it('skips members with no ORCID', async () => {
    writeFileSync(
      join(dir, 'alice.md'),
      '---\nname: Alice\n---\nbody'
    )
    expect(await scanMembersWithOrcid(dir)).toEqual([])
  })

  it('skips hidden members', async () => {
    writeFileSync(
      join(dir, 'alice.md'),
      '---\nname: Alice\norcid: 0000-0001-2345-6789\n_hidden: true\n---\nbody'
    )
    expect(await scanMembersWithOrcid(dir)).toEqual([])
  })

  it('skips members with invalid ORCIDs (bad checksum)', async () => {
    // Suppress console.warn during this test
    const original = console.warn
    console.warn = () => {}
    try {
      writeFileSync(
        join(dir, 'alice.md'),
        '---\nname: Alice\norcid: 0000-0001-2345-6780\n---\nbody'
      )
      expect(await scanMembersWithOrcid(dir)).toEqual([])
    } finally {
      console.warn = original
    }
  })

  it('extracts ORCID from a full URL form', async () => {
    writeFileSync(
      join(dir, 'alice.md'),
      '---\nname: Alice\norcid: https://orcid.org/0000-0001-2345-6789\n---\nbody'
    )
    const members = await scanMembersWithOrcid(dir)
    expect(members[0].orcid).toBe('0000-0001-2345-6789')
  })

  it('handles multiple members in nested directories', async () => {
    const sub = join(dir, 'group')
    mkdirSync(sub)
    // Both ORCIDs are valid per ISO 7064 11-2:
    //   0000-0001-2345-6789 (check digit 9)
    //   0000-0001-2345-6797 (check digit 7)
    writeFileSync(join(dir, 'a.md'), '---\nname: A\norcid: 0000-0001-2345-6789\n---\n')
    writeFileSync(join(sub, 'b.md'), '---\nname: B\norcid: 0000-0001-2345-6797\n---\n')
    const members = await scanMembersWithOrcid(dir)
    expect(members).toHaveLength(2)
    expect(members.map(m => m.name).sort()).toEqual(['A', 'B'])
  })

  it('collapses locale variants to one member, reading the default', async () => {
    // Default (en) carries the ORCID; the zh-CN partial overrides only the name
    // and omits orcid. Only the default variant should be read.
    writeFileSync(
      join(dir, 'ruibin-bai.md'),
      '---\nname: Ruibin Bai\norcid: 0000-0003-1722-568X\n---\nbody'
    )
    writeFileSync(
      join(dir, 'ruibin-bai.zh-CN.md'),
      '---\nname: 白瑞斌\n---\nbody'
    )
    const members = await scanMembersWithOrcid(dir)
    expect(members).toHaveLength(1)
    expect(members[0]).toEqual({ name: 'Ruibin Bai', orcid: '0000-0003-1722-568X' })
  })

  it('does not double-count an ORCID present in both variants', async () => {
    // If both variants somehow carry the same ORCID, the member is still one.
    writeFileSync(
      join(dir, 'dup.md'),
      '---\nname: Dup En\norcid: 0000-0001-2345-6789\n---\n'
    )
    writeFileSync(
      join(dir, 'dup.zh-CN.md'),
      '---\nname: Dup Zh\norcid: 0000-0001-2345-6789\n---\n'
    )
    const members = await scanMembersWithOrcid(dir)
    expect(members).toHaveLength(1)
    // The default (non-suffixed) variant wins.
    expect(members[0].name).toBe('Dup En')
  })

  it('falls back to a variant when only suffixed files exist', async () => {
    // No default file — the alphabetically smallest variant is read.
    writeFileSync(
      join(dir, 'only.en.md'),
      '---\nname: Only En\norcid: 0000-0001-2345-6789\n---\n'
    )
    writeFileSync(
      join(dir, 'only.zh-CN.md'),
      '---\nname: 只有中文\n---\n'
    )
    const members = await scanMembersWithOrcid(dir)
    expect(members).toHaveLength(1)
    expect(members[0]).toEqual({ name: 'Only En', orcid: '0000-0001-2345-6789' })
  })

  it('takes a field the default lacks from the first variant that has it', async () => {
    // Default has name but NO orcid; the zh-CN variant carries the orcid.
    // Field-level merge: name from default, orcid from the variant.
    writeFileSync(
      join(dir, 'ruibin-bai.md'),
      '---\nname: Ruibin Bai\n---\nbody'
    )
    writeFileSync(
      join(dir, 'ruibin-bai.zh-CN.md'),
      '---\nname: 白瑞斌\norcid: 0000-0003-1722-568X\n---\n'
    )
    const members = await scanMembersWithOrcid(dir)
    expect(members).toHaveLength(1)
    expect(members[0]).toEqual({ name: 'Ruibin Bai', orcid: '0000-0003-1722-568X' })
  })

  it('merges fields across multiple variants by alphabetical order', async () => {
    // No default. name only in zh-CN, orcid only in en. en < zh-CN → orcid from
    // en, name falls back to zh-CN (the next variant with a name).
    writeFileSync(
      join(dir, 'split.en.md'),
      '---\norcid: 0000-0001-2345-6789\n---\n'
    )
    writeFileSync(
      join(dir, 'split.zh-CN.md'),
      '---\nname: Split Zh\n---\n'
    )
    const members = await scanMembersWithOrcid(dir)
    expect(members).toHaveLength(1)
    expect(members[0]).toEqual({ name: 'Split Zh', orcid: '0000-0001-2345-6789' })
  })
})
