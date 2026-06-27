import { describe, it, expect } from 'vitest'
import {
  isLocaleVariant,
  stripLocaleSuffix,
  variantBaseKey,
  pickPriorityVariants,
  groupVariantsByPriority,
} from '../../src/utils/locale-variants'

describe('isLocaleVariant', () => {
  it('flags locale-suffixed files', () => {
    expect(isLocaleVariant('/a/b/ruibin-bai.zh-CN.md')).toBe(true)
    expect(isLocaleVariant('/a/b/name.en.md')).toBe(true)
    expect(isLocaleVariant('/a/b/name.zh-TW.md')).toBe(true)
  })

  it('treats the non-suffixed file as the default (not a variant)', () => {
    expect(isLocaleVariant('/a/b/ruibin-bai.md')).toBe(false)
    expect(isLocaleVariant('/a/b/index.md')).toBe(false)
  })

  it('does not misread ordinary dotted filenames as variants', () => {
    expect(isLocaleVariant('/a/b/john.smith.md')).toBe(false)
    expect(isLocaleVariant('/a/b/ai.md')).toBe(false)
  })
})

describe('stripLocaleSuffix', () => {
  it('strips the locale dot-suffix', () => {
    expect(stripLocaleSuffix('ruibin-bai.zh-CN.md')).toBe('ruibin-bai')
    expect(stripLocaleSuffix('name.en.md')).toBe('name')
  })

  it('leaves the default filename minus .md', () => {
    expect(stripLocaleSuffix('ruibin-bai.md')).toBe('ruibin-bai')
  })
})

describe('variantBaseKey', () => {
  it('collapses variants of the same content to one key', () => {
    expect(variantBaseKey('/m/staff/ruibin-bai.md')).toBe('/m/staff/ruibin-bai')
    expect(variantBaseKey('/m/staff/ruibin-bai.zh-CN.md')).toBe('/m/staff/ruibin-bai')
    expect(variantBaseKey('/m/staff/ruibin-bai.en-US.md')).toBe('/m/staff/ruibin-bai')
  })
})

describe('pickPriorityVariants', () => {
  it('keeps the default (non-suffixed) file when present', () => {
    const files = [
      '/m/ruibin-bai.zh-CN.md',
      '/m/ruibin-bai.md',
      '/m/other.md',
    ]
    expect(pickPriorityVariants(files).sort()).toEqual(
      ['/m/ruibin-bai.md', '/m/other.md'].sort(),
    )
  })

  it('falls back to the alphabetically smallest variant when no default exists', () => {
    const files = ['/m/name.zh-CN.md', '/m/name.en.md']
    expect(pickPriorityVariants(files)).toEqual(['/m/name.en.md'])
  })

  it('passes through files with no variants unchanged', () => {
    const files = ['/m/a.md', '/m/b.md']
    expect(pickPriorityVariants(files).sort()).toEqual(['/m/a.md', '/m/b.md'].sort())
  })

  it('does not collapse distinct members that happen to share a basename dir', () => {
    const files = ['/m/staff/alice.md', '/m/alumni/alice.md']
    // different directories → different keys → both kept
    expect(pickPriorityVariants(files)).toHaveLength(2)
  })
})

describe('groupVariantsByPriority', () => {
  it('orders each group: default first, then alphabetical', () => {
    const files = [
      '/m/ruibin-bai.zh-CN.md',
      '/m/ruibin-bai.md',
      '/m/ruibin-bai.en-US.md',
    ]
    const groups = groupVariantsByPriority(files)
    expect(groups).toEqual([
      ['/m/ruibin-bai.md', '/m/ruibin-bai.en-US.md', '/m/ruibin-bai.zh-CN.md'],
    ])
  })

  it('keeps separate groups for distinct members', () => {
    const files = ['/m/a.md', '/m/a.zh-CN.md', '/m/b.md']
    const groups = groupVariantsByPriority(files)
    expect(groups.map(g => g.length).sort()).toEqual([1, 2])
  })

  it('alphabetical-only when no default file exists', () => {
    const files = ['/m/x.zh-CN.md', '/m/x.en.md']
    expect(groupVariantsByPriority(files)).toEqual([['/m/x.en.md', '/m/x.zh-CN.md']])
  })
})
