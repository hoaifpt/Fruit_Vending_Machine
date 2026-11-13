// Known axe findings that must not block the suite, each with the reason and where it will be fixed.
// Allowed for screens outside the milestone under test, or for a deliberate design choice that waits for a decision;
// never a global rule switch. Matching findings are still listed in e2e-report/ux-summary.md, marked "đã biết".
export interface KnownViolation {
  /** Screen name used by the specs (login, orders, kit, forbidden, kiosk-catalog, kiosk-payment). */
  screen: string
  /** axe rule id. */
  rule: string
  /** Only nodes whose axe selector contains this text. */
  target?: string
  /** Only nodes inside an element matching this CSS selector (checked in the page). */
  within?: string
  reason: string
}

// FE 5.1 removed the kiosk product-button entry: the button's visible text is now its accessible name.
export const KNOWN_VIOLATIONS: KnownViolation[] = []

export interface NodeInfo { target: string; within: Record<string, boolean> }

/** Selectors the page must test for each node (`within` entries for this screen and rule). */
export function withinSelectors(screen: string, rule: string): string[] {
  return KNOWN_VIOLATIONS.filter(entry => entry.screen === screen && entry.rule === rule && entry.within).map(entry => entry.within!)
}

/** The reason when every node of this finding is covered by a known entry, otherwise null. */
export function knownViolation(screen: string, rule: string, nodes: NodeInfo[]): string | null {
  const entries = KNOWN_VIOLATIONS.filter(entry => entry.screen === screen && entry.rule === rule)
  if (!entries.length || !nodes.length) return null
  const matches = (entry: KnownViolation, node: NodeInfo) => (!entry.target || node.target.includes(entry.target)) && (!entry.within || node.within[entry.within] === true)
  const used = entries.filter(entry => nodes.some(node => matches(entry, node)))
  return nodes.every(node => entries.some(entry => matches(entry, node))) ? used.map(entry => entry.reason).join('; ') : null
}
