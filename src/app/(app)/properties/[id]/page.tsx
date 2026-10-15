import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/workspace";
import { OwnersEditor, PropertyDetailsForm } from "./PropertyEditor";

export const metadata: Metadata = { title: "Property" };

const cents = (c: number | null) => (c === null || c === undefined ? "" : (Number(c) / 100).toFixed(2));

export default async function PropertyPage({ params }: PageProps<"/properties/[id]">) {
  const { id } = await params;
  const { supabase } = await getSession();

  const { data: p } = await supabase
    .from("properties")
    .select("id, name, entity_id, portfolio_id, rental_type, address_line1, city, state, postal_code, acquired_on, placed_in_service_on, purchase_price_cents, sold_on")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();

  const [{ data: portfolios }, { data: entities }, { data: owners }, { count: activity }, { count: accounts }] = await Promise.all([
    supabase.from("portfolios").select("id, name").order("name"),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("property_owners").select("entity_id, percent_bp").eq("property_id", id),
    supabase.from("journal_lines").select("id", { count: "exact", head: true }).eq("property_id", id).eq("entity_id", p.entity_id),
    supabase.from("accounts").select("id", { count: "exact", head: true }).eq("property_id", id).eq("entity_id", p.entity_id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="rise space-y-1">
        <Link href="/properties" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Properties
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{p.name}</h1>
          <Link href={`/properties/${p.id}/sale`} className="inline-flex h-9 items-center rounded-xl border border-border-strong bg-surface px-3.5 text-sm font-medium hover:bg-brand-50">
            {p.sold_on ? "View sale" : "Record sale"}
          </Link>
        </div>
      </header>

      <section aria-labelledby="h-details" className="rise">
        <h2 id="h-details" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Details
        </h2>
        <Card className="p-6">
          <PropertyDetailsForm
            property={{
              id: p.id as string,
              name: p.name as string,
              rentalType: p.rental_type as string,
              portfolioId: p.portfolio_id as string,
              address: (p.address_line1 as string | null) ?? "",
              city: (p.city as string | null) ?? "",
              state: (p.state as string | null) ?? "",
              postalCode: (p.postal_code as string | null) ?? "",
              acquiredOn: (p.acquired_on as string | null) ?? "",
              placedInServiceOn: (p.placed_in_service_on as string | null) ?? "",
              purchasePrice: cents(p.purchase_price_cents as number | null),
            }}
            portfolios={portfolios ?? []}
          />
        </Card>
      </section>

      <section aria-labelledby="h-owners" className="rise">
        <h2 id="h-owners" className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
          Who owns it
        </h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">
          A property can be owned by one legal entity or several, each with a share. The owner that keeps the books holds its bank accounts, loans and transactions. Reports show every owner its share.
        </p>
        <Card className="p-6">
          <OwnersEditor
            propertyId={p.id as string}
            entities={entities ?? []}
            initial={(owners ?? []).map((o) => ({ entityId: o.entity_id as string, percentBp: o.percent_bp as number }))}
            primary={p.entity_id as string}
            locked={(activity ?? 0) > 0 || (accounts ?? 0) > 0}
          />
        </Card>
      </section>
    </div>
  );
}
