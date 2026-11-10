// Ranking for the Ctrl+K palette (cmdk `filter`). Matches the Vietnamese label as typed, with or without diacritics, on
// whole substrings rather than cmdk's scattered-letter fuzzy match, so "thanh" finds "Thanh toán" before anything else.

/** Vietnamese without diacritics, lower case, single spaces: "Máy bán hàng" → "may ban hang". */
export function plainText(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Score of one item for the typed search (cmdk: 0 hides it, higher sorts first). `value` is the item's visible label.
 * Label start 1 > label word start 0.9 > anywhere in the label 0.8 > a secondary keyword (group name, synonyms) 0.3,
 * so a keyword can find an item but never ranks it above an item whose own label matches.
 */
export function commandScore(value: string, search: string, keywords: readonly string[] = []): number {
  const query = plainText(search)
  if (!query) return 1
  const label = plainText(value)
  if (label.startsWith(query)) return 1
  if (` ${label}`.includes(` ${query}`)) return 0.9
  if (label.includes(query)) return 0.8
  return keywords.some(keyword => plainText(keyword).includes(query)) ? 0.3 : 0
}
