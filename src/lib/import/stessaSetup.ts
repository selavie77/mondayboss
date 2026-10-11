import type { StessaLedger } from "./stessa";
import { categoryKey, matchProperty, sourceKey, suggestSource, type CashAccountInfo, type MatchLevel, type SourceSuggestion } from "./stessaMatch";
import { isUnresolved, mapStessaRow } from "./stessaMapping";

/** Everything the "Match your Stessa data" step shows: each Stessa value with the match we suggest for it. */

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  isCash: boolean;
  last4: string | null;
}

export type PropertySuggestion =
  | { kind: "existing"; id: string; name: string; level: MatchLevel | "saved" }
  | { kind: "create" };

export type PortfolioSuggestion =
  | { kind: "existing"; id: string; name: string; level: "exact" | "saved" }
  | { kind: "create" };

export interface PortfolioSetup {
  stessaName: string;
  rows: number;
  /** How many of the Stessa properties belong to it. */
  properties: number;
  suggestion: PortfolioSuggestion;
}

export interface PropertySetup {
  stessaName: string;
  rows: number;
  /** The Stessa portfolio most of its rows belong to. */
  stessaPortfolio: string | null;
  suggestion: PropertySuggestion;
}

export interface SourceSetup {
  key: string;
  source: string;
  account: string;
  rows: number;
  suggestion: Omit<SourceSuggestion, "level"> & { level?: MatchLevel | "saved" };
}

export interface CategorySetup {
  key: string;
  category: string;
  sub: string;
  rows: number;
  /** Where our rules would put it, e.g. "Repairs › Plumbing Repairs (new)". Empty when we could not place it. */
  defaultLabel: string;
  unresolved: boolean;
  /** Why some rows in this category wait in Review, when they do. */
  held: string | null;
  /** An account chosen for this category in an earlier import. */
  savedAccountId: string | null;
}

export interface StessaSetup {
  portfolios: PortfolioSetup[];
  existingPortfolios: { id: string; name: string }[];
  properties: PropertySetup[];
  sources: SourceSetup[];
  categories: CategorySetup[];
  existingProperties: { id: string; name: string }[];
  cashAccounts: { id: string; name: string; last4: string | null }[];
  /** Accounts a category can be posted to (everything except bank accounts and cards). */
  accountOptions: { id: string; label: string; type: AccountRow["type"]; topLevel: boolean }[];
}

export interface SavedMappings {
  portfolio: Map<string, string>;
  property: Map<string, string>;
  source: Map<string, string>;
  category: Map<string, string>;
}

const lower = (s: string) => s.trim().toLowerCase();

export function buildStessaSetup(o: {
  ledgers: StessaLedger[];
  properties: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  accounts: AccountRow[];
  saved: SavedMappings;
}): StessaSetup {
  const rows = o.ledgers.flatMap((l) => l.rows);
  const byId = new Map(o.accounts.map((a) => [a.id, a]));
  const byCode = new Map(o.accounts.map((a) => [a.code, a]));
  const stessaProperties = [...new Set(rows.map((r) => r.property).filter(Boolean))];

  // Which Stessa portfolio each property belongs to (the one most of its rows name).
  const portfolioVotes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.property || !r.portfolio) continue;
    const votes = portfolioVotes.get(r.property) ?? new Map<string, number>();
    votes.set(r.portfolio, (votes.get(r.portfolio) ?? 0) + 1);
    portfolioVotes.set(r.property, votes);
  }
  const portfolioOf = (property: string) => [...(portfolioVotes.get(property) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Portfolios: matched by name, or created.
  const portfolioRows = new Map<string, number>();
  for (const r of rows) if (r.portfolio) portfolioRows.set(r.portfolio, (portfolioRows.get(r.portfolio) ?? 0) + 1);
  const portfolios: PortfolioSetup[] = [...portfolioRows].map(([stessaName, n]) => {
    const savedId = o.saved.portfolio.get(stessaName);
    const savedP = savedId ? o.portfolios.find((p) => p.id === savedId) : undefined;
    const byName = o.portfolios.find((p) => lower(p.name) === lower(stessaName));
    const hit = savedP ?? byName;
    return {
      stessaName,
      rows: n,
      properties: [...portfolioVotes.keys()].filter((p) => portfolioOf(p) === stessaName).length,
      suggestion: hit ? { kind: "existing", id: hit.id, name: hit.name, level: savedP ? "saved" : "exact" } : { kind: "create" },
    };
  });

  // Properties
  const propertyRows = new Map<string, number>();
  for (const r of rows) if (r.property) propertyRows.set(r.property, (propertyRows.get(r.property) ?? 0) + 1);
  const properties: PropertySetup[] = [...propertyRows].map(([stessaName, n]) => {
    const stessaPortfolio = portfolioOf(stessaName);
    const savedId = o.saved.property.get(stessaName);
    const savedProp = savedId ? o.properties.find((p) => p.id === savedId) : undefined;
    if (savedProp) return { stessaName, rows: n, stessaPortfolio, suggestion: { kind: "existing", id: savedProp.id, name: savedProp.name, level: "saved" } };
    const m = matchProperty(stessaName, o.properties);
    return { stessaName, rows: n, stessaPortfolio, suggestion: m ? { kind: "existing", id: m.id, name: m.name, level: m.level } : { kind: "create" } };
  });

  // Data sources
  const cash: CashAccountInfo[] = o.accounts.filter((a) => a.isCash).map((a) => ({ id: a.id, name: a.name, last4: a.last4 }));
  const sourceRows = new Map<string, { source: string; account: string; n: number }>();
  for (const r of rows) {
    const k = sourceKey(r.source, r.account);
    const cur = sourceRows.get(k);
    if (cur) cur.n += 1;
    else sourceRows.set(k, { source: r.source, account: r.account, n: 1 });
  }
  const sources: SourceSetup[] = [...sourceRows].map(([key, v]) => {
    const savedId = o.saved.source.get(key);
    const savedAcct = savedId ? cash.find((c) => c.id === savedId) : undefined;
    const base = suggestSource(v.source, v.account, cash, stessaProperties);
    const suggestion = savedAcct
      ? { ...base, kind: "existing" as const, existingId: savedAcct.id, existingName: savedAcct.name, level: "saved" as const }
      : base;
    return { key, source: v.source, account: v.account, rows: v.n, suggestion };
  });

  // Categories
  const label = (code: string, sub?: string) => {
    const parent = byCode.get(code);
    const parentName = parent?.name ?? code;
    if (!sub) return parentName;
    const child = parent ? o.accounts.find((a) => a.parentId === parent.id && lower(a.name) === lower(sub)) : undefined;
    return `${parentName} › ${sub}${child ? "" : " (new)"}`;
  };
  const groups = new Map<string, { category: string; sub: string; rows: typeof rows }>();
  for (const r of rows) {
    const k = categoryKey(r);
    const g = groups.get(k);
    if (g) g.rows.push(r);
    else groups.set(k, { category: r.category ?? "", sub: r.subCategory ?? "", rows: [r] });
  }
  const categories: CategorySetup[] = [...groups].map(([key, g]) => {
    const mapped = g.rows.map(mapStessaRow);
    const first = mapped[0];
    const unresolved = isUnresolved(first);
    const held = mapped.map((m) => (!isUnresolved(m) ? (m.review ?? null) : null)).find(Boolean) ?? null;
    let defaultLabel = "";
    if (!isUnresolved(first)) {
      defaultLabel = first.fixed
        ? `Debit ${label(first.fixed.debitCode)} · Credit ${label(first.fixed.creditCode)}`
        : label(first.counterCode, first.sub);
    }
    const savedId = o.saved.category.get(key);
    return {
      key,
      category: g.category,
      sub: g.sub,
      rows: g.rows.length,
      defaultLabel,
      unresolved,
      held,
      savedAccountId: savedId && byId.has(savedId) && !byId.get(savedId)!.isCash ? savedId : null,
    };
  });
  categories.sort((a, b) => b.rows - a.rows);

  const accountOptions = o.accounts
    .filter((a) => !a.isCash)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => {
      const parent = a.parentId ? byId.get(a.parentId) : undefined;
      return { id: a.id, label: `${a.code} · ${parent ? `${parent.name} › ` : ""}${a.name}`, type: a.type, topLevel: !a.parentId };
    });

  return {
    portfolios: portfolios.sort((a, b) => b.rows - a.rows),
    existingPortfolios: o.portfolios,
    properties: properties.sort((a, b) => a.stessaName.localeCompare(b.stessaName, undefined, { numeric: true })),
    sources: sources.sort((a, b) => b.rows - a.rows),
    categories,
    existingProperties: o.properties,
    cashAccounts: cash,
    accountOptions,
  };
}
