import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { RealEstateTabs } from "@/components/RealEstateTabs";
import { getSession } from "@/lib/workspace";
import { EntityForm } from "../forms";
import { EntityRow } from "./EntityRow";

export const metadata: Metadata = { title: "Legal entities" };

export default async function EntitiesPage() {
  const { supabase } = await getSession();
  const [{ data: entities }, { data: properties }, { data: owners }] = await Promise.all([
    supabase.from("entities").select("id, name, type").order("name"),
    supabase.from("properties").select("entity_id"),
    supabase.from("property_owners").select("entity_id"),
  ]);
  // Whether each entity has any transactions yet.
  const counts = await Promise.all((entities ?? []).map((e) => supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("entity_id", e.id)));

  const keeps = new Map<string, number>();
  for (const p of properties ?? []) keeps.set(p.entity_id as string, (keeps.get(p.entity_id as string) ?? 0) + 1);
  const shares = new Map<string, number>();
  for (const o of owners ?? []) shares.set(o.entity_id as string, (shares.get(o.entity_id as string) ?? 0) + 1);
  const active = new Set((entities ?? []).filter((_, i) => (counts[i].count ?? 0) > 0).map((e) => e.id as string));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="rise">
        <h1 className="text-3xl font-semibold tracking-tight">Legal entities</h1>
        <p className="mt-1 max-w-2xl text-muted">
          A legal entity is a person or company that owns property, such as an LLC. Each one has its own books and tax forms, and you can see them separately or combined in reports.
        </p>
      </header>
      <RealEstateTabs />

      <Card className="rise overflow-hidden">
        {(entities?.length ?? 0) === 0 ? (
          <p className="p-8 text-center text-muted">No legal entities yet. Add your first one below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {entities!.map((e) => (
              <EntityRow
                key={e.id}
                id={e.id as string}
                name={e.name as string}
                type={e.type as string}
                keepsBooksFor={keeps.get(e.id as string) ?? 0}
                sharesIn={shares.get(e.id as string) ?? 0}
                hasActivity={active.has(e.id as string)}
              />
            ))}
          </ul>
        )}
      </Card>

      <section aria-labelledby="add" className="rise">
        <h2 id="add" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Add a legal entity
        </h2>
        <Card className="p-6 sm:p-8">
          <EntityForm next="entities" />
        </Card>
      </section>
    </div>
  );
}
