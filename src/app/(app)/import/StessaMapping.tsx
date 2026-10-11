"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, PlusCircle } from "lucide-react";
import { Input, Select } from "@/components/ui";
import type { PortfolioOption } from "@/components/PortfolioSelect";
import type { CategoryChoice, MatchState, PortfolioChoice, PropertyChoice, SourceChoice } from "@/lib/import/matchState";
import { unconfirmed } from "@/lib/import/matchState";
import type { StessaSetup } from "@/lib/import/stessaSetup";

const NEW = "create";
const DEFAULT = "default";

function Badge({ tone, children }: { tone: "good" | "new" | "warn" | "muted"; children: ReactNode }) {
  const style = {
    good: "bg-emerald-50 text-emerald-800",
    new: "bg-brand-100 text-brand-700",
    warn: "bg-warning-bg text-warning-fg",
    muted: "bg-border text-muted",
  }[tone];
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>{children}</span>;
}

function Section({ title, hint, attention, open, children }: { title: string; hint: string; attention: number; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="text-[13px] text-muted">{hint}</p>
        </div>
        {attention > 0 && (
          <Badge tone="warn">
            <AlertTriangle className="h-3 w-3" aria-hidden /> {attention} to confirm
          </Badge>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-subtle transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border/70 px-4 pb-3">{children}</div>
    </details>
  );
}

const rowClass = "grid gap-x-4 gap-y-1.5 border-b border-border/60 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]";

export function StessaMapping({
  setup,
  state,
  onChange,
  portfolios,
  defaultPortfolioId,
}: {
  setup: StessaSetup;
  state: MatchState;
  onChange: (next: MatchState) => void;
  portfolios: PortfolioOption[];
  defaultPortfolioId: string;
}) {
  const todo = unconfirmed(setup, state);
  const confirm = (key: string) => onChange({ ...state, confirmed: { ...state.confirmed, [key]: true } });
  const setProperty = (name: string, c: PropertyChoice) =>
    onChange({ ...state, properties: { ...state.properties, [name]: c }, confirmed: { ...state.confirmed, [`p:${name}`]: true } });
  const setSource = (key: string, c: SourceChoice) =>
    onChange({ ...state, sources: { ...state.sources, [key]: c }, confirmed: { ...state.confirmed, [`s:${key}`]: true } });
  const setPortfolio = (name: string, c: PortfolioChoice) => onChange({ ...state, portfolios: { ...state.portfolios, [name]: c } });
  const setCategory = (key: string, c: CategoryChoice) => onChange({ ...state, categories: { ...state.categories, [key]: c } });

  const newProps = setup.properties.filter((p) => state.properties[p.stessaName]?.kind === "create");
  const topLevel = setup.accountOptions.filter((a) => a.topLevel);
  const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold">Match your Stessa data</h3>
        <p className="text-sm text-muted">
          Each Stessa property, bank account and category is matched below to something in your books, or created for you. Change any match you don&apos;t agree with.
        </p>
      </div>

      {/* Portfolios */}
      {setup.portfolios.length > 0 && (
        <Section
          title={`Portfolios (${setup.portfolios.length})`}
          hint={
            setup.portfolios.some((p) => state.portfolios[p.stessaName]?.kind === "create")
              ? "New portfolios are created with the names Stessa uses. Your properties are placed in them."
              : "All match portfolios you already have."
          }
          attention={0}
          open
        >
          {setup.portfolios.map((p) => {
            const c = state.portfolios[p.stessaName];
            const id = `pf-${p.stessaName}`;
            return (
              <div key={p.stessaName} className={rowClass}>
                <div className="min-w-0">
                  <p className="break-words font-medium">{p.stessaName}</p>
                  <p className="num text-[12px] text-muted">
                    {p.properties} {p.properties === 1 ? "property" : "properties"} · {p.rows.toLocaleString("en-US")} transactions
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={id} className="sr-only">
                    Match portfolio {p.stessaName} to
                  </label>
                  <Select
                    compact
                    id={id}
                    value={c?.kind === "existing" ? c.id : NEW}
                    onChange={(e) => setPortfolio(p.stessaName, e.target.value === NEW ? { kind: "create", name: p.stessaName } : { kind: "existing", id: e.target.value })}
                  >
                    <option value={NEW}>＋ Create a new portfolio</option>
                    {setup.existingPortfolios.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                  {c?.kind === "create" && (
                    <div>
                      <label className={label} htmlFor={`${id}-name`}>
                        Portfolio name
                      </label>
                      <Input compact id={`${id}-name`} value={c.name} maxLength={60} onChange={(e) => setPortfolio(p.stessaName, { kind: "create", name: e.target.value })} />
                    </div>
                  )}
                  <div>
                    {c?.kind === "create" ? (
                      <Badge tone="new">
                        <PlusCircle className="h-3 w-3" aria-hidden /> New portfolio
                      </Badge>
                    ) : (
                      <Badge tone="good">
                        <CheckCircle2 className="h-3 w-3" aria-hidden /> Matched
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </Section>
      )}

      {/* Properties */}
      <Section
        title={`Properties (${setup.properties.length})`}
        hint={newProps.length > 0 ? `${newProps.length} will be created. The rest match properties you already have.` : "All match properties you already have."}
        attention={todo.properties.length}
        open
      >
        {setup.properties.map((p) => {
          const c = state.properties[p.stessaName];
          const needsConfirm = todo.properties.includes(p.stessaName);
          const id = `prop-${p.stessaName}`;
          return (
            <div key={p.stessaName} className={rowClass}>
              <div className="min-w-0">
                <p className="break-words font-medium">{p.stessaName}</p>
                <p className="num text-[12px] text-muted">{p.rows.toLocaleString("en-US")} transactions in Stessa</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={id} className="sr-only">
                  Match {p.stessaName} to
                </label>
                <Select
                  compact
                  id={id}
                  value={c?.kind === "existing" ? c.id : NEW}
                  onChange={(e) =>
                    setProperty(p.stessaName, e.target.value === NEW ? { kind: "create", portfolio: p.stessaPortfolio ? `stessa:${p.stessaPortfolio}` : defaultPortfolioId } : { kind: "existing", id: e.target.value })
                  }
                >
                  <option value={NEW}>＋ Create as a new property</option>
                  {setup.existingProperties.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
                {c?.kind === "create" && (
                  <div className="flex items-center gap-2">
                    <label htmlFor={`${id}-pf`} className="text-[12px] text-muted">
                      Portfolio
                    </label>
                    <Select compact id={`${id}-pf`} className="max-w-56" value={c.portfolio} onChange={(e) => setProperty(p.stessaName, { kind: "create", portfolio: e.target.value })}>
                      {p.stessaPortfolio && (
                        <option value={`stessa:${p.stessaPortfolio}`}>
                          {p.stessaPortfolio}
                          {state.portfolios[p.stessaPortfolio]?.kind === "create" ? " (new)" : ""}
                        </option>
                      )}
                      {portfolios.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {c?.kind === "create" ? (
                    <Badge tone="new">
                      <PlusCircle className="h-3 w-3" aria-hidden /> New property
                    </Badge>
                  ) : needsConfirm ? (
                    <>
                      <Badge tone="warn">
                        <AlertTriangle className="h-3 w-3" aria-hidden /> Similar name. Is it the same property?
                      </Badge>
                      <button type="button" onClick={() => confirm(`p:${p.stessaName}`)} className="text-[12px] font-semibold text-brand-700 underline underline-offset-2">
                        Yes, same
                      </button>
                    </>
                  ) : (
                    <Badge tone="good">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> Matched
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </Section>

      {/* Data sources */}
      <Section
        title={`Bank accounts and data sources (${setup.sources.length})`}
        hint="Where each transaction was recorded in Stessa. Matched or created accounts keep their own balances."
        attention={todo.sources.length}
        open={todo.sources.length > 0}
      >
        {setup.sources.map((s) => {
          const c = state.sources[s.key];
          const needsConfirm = todo.sources.includes(s.key);
          const id = `src-${s.key}`;
          const title = [s.source, s.account.replace(/^[\s\-–]+/, "")].filter(Boolean).join(" – ") || "No source recorded";
          return (
            <div key={s.key} className={rowClass}>
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {title}
                </p>
                <p className="num text-[12px] text-muted">{s.rows.toLocaleString("en-US")} transactions</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={id} className="sr-only">
                  Account for {title}
                </label>
                <Select
                  compact
                  id={id}
                  value={c?.kind === "existing" ? c.id : c?.kind === "create" ? NEW : DEFAULT}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === DEFAULT) setSource(s.key, { kind: "default" });
                    else if (v === NEW)
                      setSource(s.key, { kind: "create", name: s.suggestion.proposedName, accountKind: s.suggestion.accountKind, last4: s.suggestion.last4, tieToProperty: s.suggestion.tieToProperty });
                    else setSource(s.key, { kind: "existing", id: v });
                  }}
                >
                  <option value={DEFAULT}>Use the general account (Operating Checking)</option>
                  {setup.cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.last4 ? ` (${a.last4})` : ""}
                    </option>
                  ))}
                  <option value={NEW}>＋ Create a new account</option>
                </Select>
                {c?.kind === "create" && (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <div>
                      <label className={label} htmlFor={`${id}-name`}>
                        Account name
                      </label>
                      <Input compact id={`${id}-name`} value={c.name} maxLength={120} onChange={(e) => setSource(s.key, { ...c, name: e.target.value })} />
                    </div>
                    <div>
                      <label className={label} htmlFor={`${id}-kind`}>
                        Type
                      </label>
                      <Select compact id={`${id}-kind`} value={c.accountKind} onChange={(e) => setSource(s.key, { ...c, accountKind: e.target.value as "bank" | "credit_card" })}>
                        <option value="bank">Bank</option>
                        <option value="credit_card">Credit card</option>
                      </Select>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {c?.kind === "create" ? (
                    <>
                      <Badge tone="new">
                        <PlusCircle className="h-3 w-3" aria-hidden /> New account
                      </Badge>
                      {c.tieToProperty && <span className="text-[12px] text-muted">for {c.tieToProperty}</span>}
                    </>
                  ) : c?.kind === "existing" && needsConfirm ? (
                    <>
                      <Badge tone="warn">
                        <AlertTriangle className="h-3 w-3" aria-hidden /> Looks like an account you have. Same one?
                      </Badge>
                      <button type="button" onClick={() => confirm(`s:${s.key}`)} className="text-[12px] font-semibold text-brand-700 underline underline-offset-2">
                        Yes, same
                      </button>
                    </>
                  ) : c?.kind === "existing" ? (
                    <Badge tone="good">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> Matched
                    </Badge>
                  ) : (
                    <Badge tone="muted">Not tracked as its own account</Badge>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </Section>

      {/* Categories */}
      <Section
        title={`Categories (${setup.categories.length})`}
        hint={
          setup.categories.some((c) => c.unresolved)
            ? `${setup.categories.filter((c) => c.unresolved).length} we couldn't place. Choose where they go, or leave them for Review.`
            : "Our suggestions are pre-selected. Change any you want to post somewhere else."
        }
        attention={0}
        open={setup.categories.some((c) => c.unresolved)}
      >
        {setup.categories.map((cat) => {
          const c = state.categories[cat.key];
          const id = `cat-${cat.key}`;
          const title = cat.category ? (cat.sub ? `${cat.category} › ${cat.sub}` : cat.category) : "(no category)";
          return (
            <div key={cat.key} className={rowClass}>
              <div className="min-w-0">
                <p className="break-words font-medium">{title}</p>
                <p className="num text-[12px] text-muted">
                  {cat.rows.toLocaleString("en-US")} transactions
                  {cat.held ? ` · some wait in Review: ${cat.held.toLowerCase()}` : ""}
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={id} className="sr-only">
                  Post {title} to
                </label>
                <Select
                  compact
                  id={id}
                  value={c?.kind === "existing" ? c.id : c?.kind === "create" ? NEW : DEFAULT}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === DEFAULT) setCategory(cat.key, { kind: "default" });
                    else if (v === NEW) setCategory(cat.key, { kind: "create", parentId: null, type: "expense", name: cat.sub || cat.category });
                    else setCategory(cat.key, { kind: "existing", id: v });
                  }}
                >
                  <option value={DEFAULT}>{cat.unresolved ? "Decide later (send to Review)" : cat.defaultLabel}</option>
                  <optgroup label="Your accounts">
                    {setup.accountOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </optgroup>
                  <option value={NEW}>＋ Create a new category…</option>
                </Select>
                {c?.kind === "create" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className={label} htmlFor={`${id}-name`}>
                        Name
                      </label>
                      <Input compact id={`${id}-name`} value={c.name} maxLength={120} onChange={(e) => setCategory(cat.key, { ...c, name: e.target.value })} />
                    </div>
                    <div>
                      <label className={label} htmlFor={`${id}-parent`}>
                        Under
                      </label>
                      <Select compact id={`${id}-parent`} value={c.parentId ?? ""} onChange={(e) => setCategory(cat.key, { ...c, parentId: e.target.value || null })}>
                        <option value="">A new main category</option>
                        {topLevel.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {c.parentId === null && (
                      <div>
                        <label className={label} htmlFor={`${id}-type`}>
                          It is
                        </label>
                        <Select compact id={`${id}-type`} value={c.type} onChange={(e) => setCategory(cat.key, { ...c, type: e.target.value as "income" | "expense" })}>
                          <option value="expense">An expense</option>
                          <option value="income">Income</option>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}
