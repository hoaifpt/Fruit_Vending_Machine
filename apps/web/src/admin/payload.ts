/** Prefer the stored JSON payload (pretty-printed); fall back to the raw body. Always returned as plain text for escaped rendering. */
export function prettyPayload(rawPayload: string | null | undefined, rawBody: string | null | undefined): { kind: 'json' | 'raw' | 'none'; text: string } {
  if (rawPayload) {
    try { return { kind: 'json', text: JSON.stringify(JSON.parse(rawPayload), null, 2) } } catch { return { kind: 'raw', text: rawPayload } }
  }
  return rawBody ? { kind: 'raw', text: rawBody } : { kind: 'none', text: '' }
}
