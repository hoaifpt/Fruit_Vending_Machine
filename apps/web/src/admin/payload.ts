// Webhook bodies as plain text for escaped rendering and copying (never HTML).
//
// `rawPayload` on the real backend is a JSON VALUE, not a string: the entity holds a jsonb JsonNode and the DTO declares
// `type = "object"` (api.yaml's example shows an object), although the generated schema says `string | null`. Fixing
// the schema is the backend's job (proposal: `object | null`); until then every reader goes through `payloadText`, which
// accepts both: a string is kept as is, null/undefined stays null, any other value is serialised with JSON.stringify.
// `rawBody` is the exact received text and is sent only when the body was not JSON (then rawPayload is null).

/** The stored JSON body as text, whatever shape the API used (see above). */
export function payloadText(rawPayload: unknown): string | null {
  if (rawPayload === null || rawPayload === undefined) return null
  if (typeof rawPayload === 'string') return rawPayload
  try { return JSON.stringify(rawPayload) ?? null } catch { return null }
}

/** The stored body as a JS value: a parsed object/array/scalar, or undefined when there is none or it is not JSON. */
export function payloadValue(rawPayload: unknown): unknown {
  if (rawPayload === null || rawPayload === undefined) return undefined
  if (typeof rawPayload !== 'string') return rawPayload
  try { return JSON.parse(rawPayload) } catch { return undefined }
}

/** Prefer the stored JSON payload (pretty-printed); fall back to the raw body. Always returned as plain text for escaped rendering. */
export function prettyPayload(rawPayload: unknown, rawBody: string | null | undefined): { kind: 'json' | 'raw' | 'none'; text: string } {
  const text = payloadText(rawPayload)
  if (text) {
    const value = payloadValue(rawPayload)
    return value === undefined ? { kind: 'raw', text } : { kind: 'json', text: JSON.stringify(value, null, 2) }
  }
  return rawBody ? { kind: 'raw', text: rawBody } : { kind: 'none', text: '' }
}

/**
 * The body as the server stored it, without reformatting: the stored JSON on one line (`json`: re-serialised by the
 * server, so key order and spacing may differ from what the provider sent) or the exact received text when the body
 * was not JSON (`raw`: word for word).
 */
export function storedPayload(rawPayload: unknown, rawBody: string | null | undefined): { kind: 'json' | 'raw' | 'none'; text: string } {
  const text = payloadText(rawPayload)
  if (text) return { kind: 'json', text }
  return rawBody ? { kind: 'raw', text: rawBody } : { kind: 'none', text: '' }
}
