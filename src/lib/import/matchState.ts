import type { StessaSetup } from "./stessaSetup";

/** What the user has chosen in the "Match your Stessa data" step. */

export type PortfolioChoice = { kind: "existing"; id: string } | { kind: "create"; name: string };
/** A new property goes in a portfolio you have (its id), or follows its Stessa portfolio ("stessa:<name>"). */
export type PropertyChoice = { kind: "existing"; id: string } | { kind: "create"; portfolio: string };
export type SourceChoice =
  | { kind: "default" }
  | { kind: "existing"; id: string }
  | { kind: "create"; name: string; accountKind: "bank" | "credit_card"; last4: string; tieToProperty: string | null };
export type CategoryChoice =
  | { kind: "default" }
  | { kind: "existing"; id: string }
  | { kind: "create"; parentId: string | null; type: "income" | "expense"; name: string };

export interface MatchState {
  portfolios: Record<string, PortfolioChoice>;
  properties: Record<string, PropertyChoice>;
  sources: Record<string, SourceChoice>;
  categories: Record<string, CategoryChoice>;
  /** Near matches the user has looked at and accepted, by "p:<stessa name>" or "s:<source key>". */
  confirmed: Record<string, true>;
}

/** Start from our suggestions. Exact and remembered matches count as confirmed; near matches wait for a click. */
export function initialMatch(setup: StessaSetup, defaultPortfolioId: string): MatchState {
  const state: MatchState = { portfolios: {}, properties: {}, sources: {}, categories: {}, confirmed: {} };

  for (const p of setup.portfolios) {
    state.portfolios[p.stessaName] = p.suggestion.kind === "existing" ? { kind: "existing", id: p.suggestion.id } : { kind: "create", name: p.stessaName };
  }

  for (const p of setup.properties) {
    const s = p.suggestion;
    if (s.kind === "existing") {
      state.properties[p.stessaName] = { kind: "existing", id: s.id };
      if (s.level !== "similar") state.confirmed[`p:${p.stessaName}`] = true;
    } else {
      state.properties[p.stessaName] = { kind: "create", portfolio: p.stessaPortfolio ? `stessa:${p.stessaPortfolio}` : defaultPortfolioId };
    }
  }

  for (const src of setup.sources) {
    const s = src.suggestion;
    if (s.kind === "existing" && s.existingId) {
      state.sources[src.key] = { kind: "existing", id: s.existingId };
      if (s.level !== "similar") state.confirmed[`s:${src.key}`] = true;
    } else if (s.kind === "create") {
      state.sources[src.key] = { kind: "create", name: s.proposedName, accountKind: s.accountKind, last4: s.last4, tieToProperty: s.tieToProperty };
    } else {
      state.sources[src.key] = { kind: "default" };
    }
  }

  for (const c of setup.categories) {
    state.categories[c.key] = c.savedAccountId ? { kind: "existing", id: c.savedAccountId } : { kind: "default" };
  }
  return state;
}

/** Matches that still need the user's eyes: near matches nobody has confirmed. */
export function unconfirmed(setup: StessaSetup, state: MatchState): { properties: string[]; sources: string[] } {
  return {
    properties: setup.properties.filter((p) => state.properties[p.stessaName]?.kind === "existing" && !state.confirmed[`p:${p.stessaName}`]).map((p) => p.stessaName),
    sources: setup.sources.filter((s) => state.sources[s.key]?.kind === "existing" && !state.confirmed[`s:${s.key}`]).map((s) => s.key),
  };
}

/** A new account or category needs a name before the import can run. */
export function nameProblems(state: MatchState): string[] {
  const out: string[] = [];
  for (const [k, c] of Object.entries(state.portfolios)) if (c.kind === "create" && !c.name.trim()) out.push(`Name the new portfolio for ${k}.`);
  for (const [k, c] of Object.entries(state.sources)) if (c.kind === "create" && !c.name.trim()) out.push(`Name the new account for ${k.split("|")[0] || "a data source"}.`);
  for (const [k, c] of Object.entries(state.categories)) if (c.kind === "create" && !c.name.trim()) out.push(`Name the new category for ${k.replace("|", " › ")}.`);
  return out;
}

/** The part of the state the server needs. */
export function toMappingPayload(state: MatchState) {
  const categories: Record<string, CategoryChoice> = {};
  for (const [k, c] of Object.entries(state.categories)) if (c.kind !== "default") categories[k] = c;
  return { portfolios: state.portfolios, properties: state.properties, sources: state.sources, categories };
}
