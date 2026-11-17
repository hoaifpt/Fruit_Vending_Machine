// Keys of `fieldErrors` as the screens use them. The backend's bean validation of a request body answers with the
// field name (`quantity`, `photos[0]`), but its method validation answers with the Java path
// `<method>.<parameter>.<field>` (`update.request.percent`, `addLine.input.plannedQuantity`,
// `complete.request.lineVariances[0].reason`; e2e-real/cases/inventory.md L-01, admin.md L-04). Both are read the same
// way, so a message always lands under its field and no internal method name reaches the screen.

/**
 * Field name of one `fieldErrors` key: the last segment, or, when the path goes through a list, the path from that list
 * on (`lineVariances[0].reason`), so the index still says which row is meant. A plain key is returned as is.
 */
export function normalizeFieldKey(key: string): string {
  const parts = key.split('.').map(part => part.trim()).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? key
  const list = parts.findIndex(part => /\[\d+\]$/.test(part))
  return list >= 0 ? parts.slice(list).join('.') : parts[parts.length - 1]
}

/** `fieldErrors` with every key normalized; when two keys meet on the same field the first message is kept. */
export function normalizeFieldErrors(fieldErrors: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, message] of Object.entries(fieldErrors)) {
    const field = normalizeFieldKey(key)
    if (!(field in result)) result[field] = message
  }
  return result
}

/** `lineVariances[2].reason` → `{ list: 'lineVariances', index: 2, field: 'reason' }`; undefined for a key without an index. */
export function listFieldOf(key: string): { list: string; index: number; field: string } | undefined {
  const match = /^([A-Za-z_$][\w$]*)\[(\d+)\](?:\.(.+))?$/.exec(normalizeFieldKey(key))
  return match ? { list: match[1], index: Number(match[2]), field: match[3] ?? '' } : undefined
}
