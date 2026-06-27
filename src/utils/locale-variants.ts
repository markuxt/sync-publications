/**
 * Locale-variant deduplication for scanned content files.
 *
 * Mirrors the markuxt layer's locale convention: a markdown file may carry a
 * locale dot-suffix (`name.<locale>.md`), and the variant WITHOUT a suffix is
 * the DEFAULT-locale document. Locale variants of the same content share one
 * "base key" (directory + filename minus the locale suffix).
 *
 *   members/staff/ruibin-bai.md         → default (no suffix)
 *   members/staff/ruibin-bai.zh-CN.md   → zh-CN variant — same base key
 *
 * When the same content exists in several languages, only the HIGHEST-priority
 * variant is kept:
 *   1. the DEFAULT (non-suffixed) file, if one exists
 *   2. otherwise the alphabetically smallest path
 *      (i18n definition order isn't known to this standalone Action, so we fall
 *      back to alphabetical — matching the layer's tier-3 rule)
 *
 * "If a default exists, only the default is used." A partial locale variant
 * never shadows the default — e.g. `ruibin-bai.zh-CN.md` (which may omit the
 * `orcid` field) is ignored when `ruibin-bai.md` is present.
 */

import { basename, dirname } from 'path'

const LOCALE_SUFFIX_RE = /\.([a-z]{2}(?:-[a-z0-9]{2,3})?)\.md$/i

/** True if the file is a locale-suffixed variant (not the default). */
export function isLocaleVariant(filePath: string): boolean {
  return LOCALE_SUFFIX_RE.test(basename(filePath))
}

/** Strip the locale dot-suffix from a filename: `ruibin-bai.zh-CN` → `ruibin-bai`. */
export function stripLocaleSuffix(fileName: string): string {
  return basename(fileName).replace(LOCALE_SUFFIX_RE, '').replace(/\.md$/i, '')
}

/**
 * The grouping key for variants of one piece of content: the directory joined
 * with the filename's locale suffix stripped. Variants of the same member/pub
 * collapse to one key. Backslashes are normalised for cross-platform safety.
 */
export function variantBaseKey(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return `${dirname(normalized)}/${stripLocaleSuffix(basename(normalized))}`
}

/**
 * Group file paths by their variant base key, each group sorted by priority:
 * the default (non-suffixed) file first, then the remaining variants
 * alphabetically. Returns groups in first-seen order.
 *
 * Use this (rather than `pickPriorityVariants`) when you need a PER-FIELD
 * merge across variants — e.g. take `orcid` from the first variant (default,
 * then alphabetical) that defines it, so a field missing from the default is
 * still picked up from another language's file.
 */
export function groupVariantsByPriority(files: string[]): string[][] {
  const groups = new Map<string, string[]>()
  const order: string[] = []
  for (const f of files) {
    const key = variantBaseKey(f)
    const arr = groups.get(key)
    if (arr) arr.push(f)
    else {
      groups.set(key, [f])
      order.push(key)
    }
  }
  return order.map(key => sortVariantsByPriority(groups.get(key)!))
}

/** Sort one variant group: default (non-suffixed) first, then alphabetical. */
function sortVariantsByPriority(group: string[]): string[] {
  const def = group.find(f => !isLocaleVariant(f))
  if (def) return [def, ...group.filter(f => f !== def).sort()]
  return [...group].sort()
}

/**
 * Given scanned file paths, return one file per variant group — the
 * highest-priority variant per the rules above. Order is otherwise preserved.
 */
export function pickPriorityVariants(files: string[]): string[] {
  return groupVariantsByPriority(files).map(group => group[0])
}
