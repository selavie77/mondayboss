import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { RealEstateTabs } from "@/components/RealEstateTabs";
import { getSession } from "@/lib/workspace";
import { AddPortfolio } from "./AddPortfolio";
import { PortfolioRow } from "./PortfolioRow";

export const metadata: Metadata = { title: "Portfolios" };

export default async function PortfoliosPage() {
  const { supabase } = await getSession();
  const [{ data: portfolios }, { data: entities }, { data: properties }] = await Promise.all([
    supabase.from("portfolios").select("id, name, default_entity_id").order("name"),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("properties").select("portfolio_id, property_owners(entity_id)"),
  ]);
  const entityName = new Map((entities ?? []).map((e) => [e.id as string, e.name as string]));

  // For each portfolio: how many properties, and which entities own something in it.
  const stats = new Map<string, { count: number; owners: Map<string, number> }>();
  for (const p of properties ?? []) {
    const s = stats.get(p.portfolio_id as string) ?? { count: 0, owners: new Map<string, number>() };
    s.count += 1;
    for (const o of (p.property_owners ?? []) as { entity_id: string }[]) s.owners.set(o.entity_id, (s.owners.get(o.entity_id) ?? 0) + 1);
    stats.set(p.portfolio_id as string, s);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="rise">
        <h1 className="text-3xl font-semibold tracking-tight">Portfolios</h1>
        <p className="mt-1 max-w-2xl text-muted">
          A portfolio groups properties so you can report on them together. A portfolio can have a default owner, and its properties can be owned by different legal entities.
        </p>
      </header>
      <RealEstateTabs />

      <Card className="rise overflow-hidden">
        {(portfolios?.length ?? 0) === 0 ? (
          <p className="p-8 text-center text-muted">No portfolios yet. Add your first one below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {portfolios!.map((p) => {
              const s = stats.get(p.id as string);
              return (
                <PortfolioRow
                  key={p.id}
                  id={p.id as string}
                  name={p.name as string}
                  defaultEntityId={(p.default_entity_id as string | null) ?? null}
                  propertyCount={s?.count ?? 0}
                  owners={[...(s?.owners ?? [])].map(([id, count]) => ({ name: entityName.get(id) ?? "", count })).sort((a, b) => b.count - a.count)}
                  entities={entities ?? []}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <section aria-labelledby="add" className="rise">
        <h2 id="add" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Add a portfolio
        </h2>
        <Card className="p-6 sm:p-8">
          <AddPortfolio entities={entities ?? []} />
        </Card>
      </section>
    </div>
  );
}
