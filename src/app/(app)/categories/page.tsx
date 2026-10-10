import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/workspace";
import { taxLineLabel } from "@/lib/taxLines";
import { AddCategory } from "./AddCategory";
import { EditDescription } from "./EditDescription";

export const metadata: Metadata = { title: "Categories" };

const sections: { type: string; title: string; hint: string }[] = [
  { type: "income", title: "Income", hint: "Money coming in" },
  { type: "expense", title: "Expenses", hint: "Money going out" },
  { type: "liability", title: "Liabilities", hint: "What you owe, like mortgages" },
  { type: "equity", title: "Owner equity", hint: "Money you put in and take out" },
  { type: "asset", title: "Assets", hint: "What you own, like cash and escrow" },
];

export default async function CategoriesPage({ searchParams }: PageProps<"/categories">) {
  const { entity: entityParam } = await searchParams;
  const { supabase } = await getSession();

  const { data: entities } = await supabase.from("entities").select("id, name").order("name");
  const entity = (entities ?? []).find((e) => e.id === entityParam) ?? entities?.[0];

  const { data: accounts } = entity
    ? await supabase
        .from("accounts")
        .select("id, parent_id, code, name, type, tax_line, is_bank, description")
        .eq("entity_id", entity.id)
        .eq("is_active", true)
        .order("code")
    : { data: [] };

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

          {sections.map(({ type, title, hint }) => {
            const ofType = (accounts ?? []).filter((a) => a.type === type);
            const parents = ofType.filter((a) => !a.parent_id);
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
                              {p.is_bank && (
                                <span className="rounded-full bg-border px-2.5 py-0.5 text-xs font-medium text-muted">Bank</span>
                              )}
                            </div>
                            <div className="ml-[3.75rem] mt-1">
                              {p.description && <p className="max-w-2xl text-sm text-muted">{p.description}</p>}
                              <EditDescription id={p.id} value={p.description} />
                            </div>
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
