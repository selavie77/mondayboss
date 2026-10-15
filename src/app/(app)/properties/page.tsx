import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Card } from "@/components/ui";
import { RealEstateTabs } from "@/components/RealEstateTabs";
import { getSession } from "@/lib/workspace";
import { PropertyForm } from "../forms";

export const metadata: Metadata = { title: "Properties" };

const rentalLabel: Record<string, string> = {
  long_term: "Long-term",
  short_term: "Short-term",
  mixed: "Mixed use",
  owner_occupied: "Owner-occupied",
};

export default async function PropertiesPage() {
  const { supabase } = await getSession();
  const [{ data: properties }, { data: entities }, { data: portfolios }] = await Promise.all([
    supabase.from("properties").select("id, name, city, state, rental_type, sold_on, entities(name), portfolios(name)").order("name"),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("portfolios").select("id, name, default_entity_id").order("name"),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="rise">
        <h1 className="text-3xl font-semibold tracking-tight">Properties</h1>
        <p className="mt-1 text-muted">Every property is in one portfolio and has one or more legal entities as owners.</p>
      </header>
      <RealEstateTabs />

      <Card className="rise overflow-hidden" >
        {(properties?.length ?? 0) === 0 ? (
          <p className="p-8 text-center text-muted">No properties yet. Add your first one below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {properties!.map((p) => {
              const entity = p.entities as unknown as { name: string } | null;
              const portfolio = p.portfolios as unknown as { name: string } | null;
              return (
                <li key={p.id} className="flex items-center gap-4 px-5 py-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Building2 className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/properties/${p.id}`} className="block truncate font-medium hover:text-brand-700 hover:underline">
                      {p.name}
                    </Link>
                    <p className="truncate text-[13px] text-muted">
                      {[p.city, p.state].filter(Boolean).join(", ") || "No address"} · {entity?.name}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-sm">{portfolio?.name}</p>
                    <p className="text-[13px] text-muted">{rentalLabel[p.rental_type]}</p>
                  </div>
                  <Link
                    href={`/properties/${p.id}/sale`}
                    className={`shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium ${p.sold_on ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "border border-border-strong bg-surface text-foreground hover:bg-brand-50"}`}
                  >
                    {p.sold_on ? `Sold ${new Date(p.sold_on + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : "Record sale"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {(entities?.length ?? 0) > 0 && (
        <section aria-labelledby="add" className="rise">
          <h2 id="add" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Add a property
          </h2>
          <Card className="p-6 sm:p-8">
            <PropertyForm entities={entities ?? []} portfolios={(portfolios ?? []).map((x) => ({ id: x.id as string, name: x.name as string, defaultEntityId: x.default_entity_id as string | null }))} />
          </Card>
        </section>
      )}
    </div>
  );
}
