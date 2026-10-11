import type { StessaRow } from "./stessa";

const SUFFIX: Record<string, string> = {
  drive: "dr", street: "st", avenue: "ave", boulevard: "blvd", lane: "ln", road: "rd", court: "ct", terrace: "ter",
  place: "pl", circle: "cir", highway: "hwy", parkway: "pkwy", trail: "trl", north: "n", south: "s", east: "e", west: "w",
};

/** "5310 Kohout Street, Maple Heights, OH" and "5310 kohout st" read the same. Only the street part is kept. */
export function normalizeAddress(s: string): string {
  return s
    .split(",")[0]
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] ?? w)
    .join(" ");
}

const tokens = (s: string) => new Set(normalizeAddress(s).split(" ").filter(Boolean));

/** True when one address is the other plus extra words (a city, a unit, "Drive"), and both start with the same number. */
function sameAddress(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size < 2 || tb.size < 2) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const first = normalizeAddress(a).split(" ")[0];
  if (!/^\d/.test(first) || first !== normalizeAddress(b).split(" ")[0]) return false;
  return [...small].every((t) => big.has(t));
}

export type MatchLevel = "exact" | "similar";

/** The existing property a Stessa property most likely is. "similar" matches need a person to confirm. */
export function matchProperty(stessaName: string, existing: { id: string; name: string }[]): { id: string; name: string; level: MatchLevel } | null {
  const plain = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const exact = existing.find((p) => plain(p.name) === plain(stessaName));
  if (exact) return { ...exact, level: "exact" };
  const similar = existing.filter((p) => sameAddress(p.name, stessaName));
  return similar.length === 1 ? { ...similar[0], level: "similar" } : null;
}

// ---------------------------------------------------------------------------
// Data sources (Stessa's Source + Account columns)
// ---------------------------------------------------------------------------

export const sourceKey = (source: string, account: string) => `${source}|${account}`;
export const categoryKey = (row: Pick<StessaRow, "category" | "subCategory">) => `${row.category ?? ""}|${row.subCategory ?? ""}`;

/** Rows typed in by hand or uploaded as a file have no real bank behind them. */
export function isManualSource(source: string, account: string): boolean {
  const s = source.trim().toLowerCase();
  const a = account.trim().toLowerCase();
  return (!s && !a) || s === "imported file" || a === "manual upload";
}

export interface SourceSuggestion {
  /** No bank of its own: post to the general account. */
  kind: "default" | "existing" | "create";
  existingId?: string;
  existingName?: string;
  level?: MatchLevel;
  proposedName: string;
  accountKind: "bank" | "credit_card";
  last4: string;
  /** The Stessa property this account looks dedicated to (its name is an address). */
  tieToProperty: string | null;
}

/** A readable name and last four digits from Stessa's Source and Account text. */
export function describeSource(source: string, account: string): { name: string; last4: string; accountKind: "bank" | "credit_card" } {
  const last4 = /\bx(\d{4})\b/i.exec(account)?.[1] ?? /\bx(\d{4})\b/i.exec(source)?.[1] ?? "";
  const cleanAccount = account.replace(/^[\s\-–]+/, "").replace(/\s*\bx\d{4}\b/i, "").trim();
  const name = [source, cleanAccount].map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).join(" – ") || "Imported account";
  return { name, last4, accountKind: /credit|card|visa|mastercard|amex/i.test(`${source} ${account}`) ? "credit_card" : "bank" };
}

export interface CashAccountInfo {
  id: string;
  name: string;
  last4: string | null;
}

export function suggestSource(source: string, account: string, cash: CashAccountInfo[], stessaProperties: string[]): SourceSuggestion {
  const d = describeSource(source, account);
  const base = { proposedName: d.name, accountKind: d.accountKind, last4: d.last4 };
  if (isManualSource(source, account)) return { ...base, kind: "default", tieToProperty: null };

  const plain = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const byName = cash.find((c) => plain(c.name) === plain(d.name) || plain(c.name) === plain(account));
  const byLast4 = d.last4 ? cash.find((c) => c.last4 === d.last4) : undefined;
  const hit = byName ?? byLast4;
  const tie = stessaProperties.find((p) => sameAddress(p, account)) ?? null;
  if (hit) return { ...base, kind: "existing", existingId: hit.id, existingName: hit.name, level: byName ? "exact" : "similar", tieToProperty: tie };
  return { ...base, kind: "create", tieToProperty: tie };
}
