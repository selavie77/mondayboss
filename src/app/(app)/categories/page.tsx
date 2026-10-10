import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Landmark } from "lucide-react";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/workspace";
import { taxLineLabel } from "@/lib/taxLines";
import { isCashLike } from "@/lib/paidFrom";
import { AddCategory } from "./AddCategory";
import { AddCashAccount, OpeningBalance, ScopeSelect } from "./AccountControls";
import { EditDescription } from "./EditDescription";

export const metadata: Metadata = { title: "Categories" };

const sections: { type: string; title: string; hint: string }[] = [
  { type: "income", title: "Income", hint: "Money coming in" },
  { type: "expense", title: "Expenses", hint: "Money going out" },
  { type: "liability", title: "Liabilities", hint: "What you owe, like mortgages" },
  { type: "equity", title: "Owner equity", hint: "Money you put in and take out" },
  { type: "asset", title: "Assets", hint: "What you own, like escrow and property" },
];

const dayBefore = (d: string) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

export default async function CategoriesPage({ searchParams }: PageProps<"/categories">) {
  const { entity: entityParam } = await searchParams;
  const { supabase } = await getSession();

  const { data: entities } = await supabase.from("entities").select("id, name").order("name");
  const entity = (entities ?? []).find((e) => e.id === entityParam) ?? entities?.[0];

  const { data: accounts } = entity
    ? await supabase
        .from("accounts")
        .select("id, parent_id, code, name, type, subtype, tax_line, is_bank, description, property_id, portfolio_id, last4")
        .eq("entity_id", entity.id)
        .eq("is_active", true)
        .order("code")
    : { data: [] };
  const all = accounts ?? [];

  const [{ data: props }, { data: portfolios }, { data: firstEntries }] = entity
    ? await Promise.all([
        supabase.from("properties").select("id, name").eq("entity_id", entity.id).order("name"),
        supabase.from("portfolios").select("id, name").order("name"),
        supabase.from("journal_entries").select("entry_date, memo").eq("entity_id", entity.id).order("entry_date").limit(50),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const scopeOptions = { portfolios: portfolios ?? [], properties: props ?? [] };

  // Suggested opening balance date: the day before the first real transaction.
  const firstActivity = (firstEntries ?? []).find((e) => !/^(Reversal of )?Opening balance:/.test(e.memo ?? ""));
  const defaultAsOf = firstActivity ? dayBefore(firstActivity.entry_date) : `${new Date().getFullYear() - 1}-12-31`;

  // Active opening balances by account: posted "Opening balance:" entries that have not been reversed.
  const accountById = new Map(all.map((a) => [a.id, a]));
  const { data: openLines } = all.length
    ? await supabase
        .from("journal_lines")
        .select("account_id, debit_cents, credit_cents, entry_id, journal_entries!inner(entry_date, memo, source)")
        .in("account_id", all.map((a) => a.id))
        .eq("journal_entries.source", "system")
        .like("journal_entries.memo", "Opening balance:%")
    : { data: [] };
  const openEntryIds = [...new Set((openLines ?? []).map((l) => l.entry_id as string))];
  const { data: undone } = openEntryIds.length
    ? await supabase.from("journal_entries").select("reverses_entry_id").in("reverses_entry_id", openEntryIds)
    : { data: [] };
  const undoneIds = new Set((undone ?? []).map((u) => u.reverses_entry_id as string));
  const opening = new Map<string, { entryId: string; date: string; cents: number }>();
  for (const l of openLines ?? []) {
    if (undoneIds.has(l.entry_id as string)) continue;
    const a = accountById.get(l.account_id as string);
    if (!a || (a.type !== "asset" && a.type !== "liability")) continue;
    const debitNormal = a.type === "asset" && a.subtype !== "contra_asset";
    const net = Number(l.debit_cents) - Number(l.credit_cents);
    const je = l.journal_entries as unknown as { entry_date: string };
    opening.set(a.id, { entryId: l.entry_id as string, date: je.entry_date, cents: debitNormal ? net : -net });
  }

  const cashAccounts = all
    .filter((a) => isCashLike({ isBank: a.is_bank, subtype: a.subtype }))
    .sort((a, b) => Number(b.is_bank) - Number(a.is_bank) || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const isCash = (a: (typeof all)[number]) => isCashLike({ isBank: a.is_bank, subtype: a.subtype });
  const scopeOf = (a: (typeof all)[number]) => (a.property_id ? `p:${a.property_id}` : a.portfolio_id ? `pf:${a.portfolio_id}` : "all");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="rise">
        <h1 className="text-3xl font-semibold tracking-tight">Categories</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Organize your books your way. Anything you put in a subcategory counts toward its category, and
          a transaction with no subcategory belongs to the category itself.
        </p>
      </header>

      {!entity ? (
        <Card className="p-8 text-center text-muted">Add an entity first to see its categories.</Card>
      ) : (
        <>
          {(entities?.length ?? 0) > 1 && (
            <nav aria-label="Entity" className="rise flex flex-wrap gap-2">
              {entities!.map((e) => (
                <Link
                  key={e.id}
                  href={`/categories?entity=${e.id}`}
                  aria-current={e.id === entity.id ? "true" : undefined}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                    e.id === entity.id
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-border bg-surface text-muted hover:text-foreground"
                  }`}
                >
                  {e.name}
                </Link>
              ))}
            </nav>
          )}

          <section aria-labelledby="h-cash" className="rise space-y-3">
            <div>
              <h2 id="h-cash" className="text-sm font-semibold uppercase tracking-wide text-muted">
                Bank &amp; credit card accounts{" "}
                <span className="ml-2 font-normal normal-case tracking-normal text-subtle">Where money is paid from and into</span>
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                Tie an account to a property or a portfolio and new transactions on it will be paid from that account by default. You can always pick a different one. Enter each account&apos;s opening balance here.
              </p>
            </div>
            <Card className="overflow-hidden">
              {cashAccounts.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted">No bank accounts or credit cards yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {cashAccounts.map((a) => {
                    const card = !a.is_bank;
                    return (
                      <li key={a.id} className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[1fr_17rem]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600">
                              {card ? <CreditCard className="h-4 w-4" aria-hidden /> : <Landmark className="h-4 w-4" aria-hidden />}
                            </span>
                            <span className="font-medium">{a.name}</span>
                            {a.last4 && <span className="num text-[13px] text-muted">•••• {a.last4}</span>}
                            <span className="rounded-full bg-border px-2.5 py-0.5 text-xs font-medium text-muted">{card ? "Credit card" : "Bank"}</span>
                            <span className="num text-[13px] text-subtle">{a.code}</span>
                          </div>
                          <div className="mt-1 pl-9">
                            {a.description && <p className="max-w-xl text-sm text-muted">{a.description}</p>}
                            <EditDescription id={a.id} value={a.description} />
                          </div>
                          <div className="mt-2 pl-9">
                            <OpeningBalance
                              accountId={a.id}
                              existing={opening.get(a.id) ?? null}
                              defaultAsOf={defaultAsOf}
                              amountLabel={card ? "Balance owed" : "Balance"}
                            />
                          </div>
                        </div>
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Used for</p>
                          <ScopeSelect accountId={a.id} value={scopeOf(a)} options={scopeOptions} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <AddCashAccount entityId={entity.id} options={scopeOptions} defaultAsOf={defaultAsOf} />
          </section>

          {sections.map(({ type, title, hint }) => {
            const ofType = all.filter((a) => a.type === type && !isCash(a));
            const parents = ofType.filter((a) => !a.parent_id);
            const canOpen = type === "asset" || type === "liability";
            return (
              <section key={type} aria-labelledby={`h-${type}`} className="rise">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`h-${type}`} className="text-sm font-semibold uppercase tracking-wide text-muted">
                    {title} <span className="ml-2 font-normal normal-case tracking-normal text-subtle">{hint}</span>
                  </h2>
                  <AddCategory entityId={entity.id} type={type} />
                </div>
                <Card className="overflow-hidden">
                  {parents.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted">Nothing here yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {parents.map((p) => {
                        const children = ofType.filter((c) => c.parent_id === p.id);
                        const line = taxLineLabel(p.tax_line);
                        return (
                          <li key={p.id} className="px-5 py-3.5">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="num w-12 shrink-0 text-[13px] text-subtle">{p.code}</span>
                              <span className="font-medium">{p.name}</span>
                              {line && (
                                <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                                  Schedule E · {line}
                                </span>
                              )}
                            </div>
                            <div className="ml-[3.75rem] mt-1">
                              {p.description && <p className="max-w-2xl text-sm text-muted">{p.description}</p>}
                              <EditDescription id={p.id} value={p.description} />
                            </div>
                            {canOpen && (
                              <div className="ml-[3.75rem] mt-2">
                                <OpeningBalance
                                  accountId={p.id}
                                  existing={opening.get(p.id) ?? null}
                                  defaultAsOf={defaultAsOf}
                                  amountLabel={type === "liability" ? "Balance owed" : "Balance"}
                                />
                              </div>
                            )}
                            {children.length > 0 && (
                              <ul className="ml-[3.75rem] mt-2 space-y-1.5 border-l-2 border-brand-100 pl-4">
                                {children.map((c) => (
                                  <li key={c.id} className="text-[15px]">
                                    <div className="flex items-center gap-3">
                                      <span className="num w-14 shrink-0 text-[13px] text-subtle">{c.code}</span>
                                      {c.name}
                                    </div>
                                    <div className="ml-[4.25rem]">
                                      {c.description && <p className="max-w-2xl text-sm text-muted">{c.description}</p>}
                                      <EditDescription id={c.id} value={c.description} />
                                      {canOpen && (
                                        <div className="mt-1">
                                          <OpeningBalance
                                            accountId={c.id}
                                            existing={opening.get(c.id) ?? null}
                                            defaultAsOf={defaultAsOf}
                                            amountLabel={type === "liability" ? "Balance owed" : "Balance"}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="ml-[3.75rem] mt-2">
                              <AddCategory entityId={entity.id} type={type} parentId={p.id} parentName={p.name} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
