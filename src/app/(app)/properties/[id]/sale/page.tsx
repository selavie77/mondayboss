import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui";
import { isCashLike } from "@/lib/paidFrom";
import { factsFromRows } from "@/lib/propertySale";
import { getSession } from "@/lib/workspace";
import { SaleDate, SaleForm, UndoSale } from "./SaleForm";

export const metadata: Metadata = { title: "Record a sale" };

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const long = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export default async function SalePage({ params, searchParams }: PageProps<"/properties/[id]/sale">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await getSession();

  const { data: property } = await supabase.from("properties").select("id, name, entity_id, sold_on, sale_entry_id").eq("id", id).maybeSingle();
  if (!property) notFound();

  const back = (
    <Link href="/properties" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Properties
    </Link>
  );

  if (property.sold_on) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rise space-y-1">
          {back}
          <h1 className="text-3xl font-semibold tracking-tight">{property.name}</h1>
        </header>
        <Card className="rise space-y-4 p-6">
          <p className="text-lg font-semibold">Sold {long(property.sold_on)}</p>
          <p className="text-sm text-muted">
            The sale is recorded in your books. Find it on the{" "}
            <Link href="/transactions" className="font-medium text-brand-700 underline underline-offset-2">
              Transactions
            </Link>{" "}
            page, or undo it to enter it again.
          </p>
          <UndoSale propertyId={property.id} />
        </Card>
      </div>
    );
  }

  const rawDate = typeof sp.date === "string" ? sp.date : "";
  const date = isDate(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);

  const [{ data: rows }, { data: accts }] = await Promise.all([
    supabase.rpc("property_sale_facts", { p_property_id: property.id, p_through: date }),
    supabase.from("accounts").select("id, code, name, type, subtype, parent_id, is_bank, property_id").eq("entity_id", property.entity_id).eq("is_active", true).order("code"),
  ]);
  const facts = factsFromRows((rows ?? []) as { kind: string; account_id: string; cents: number | string }[]);
  const accounts = accts ?? [];
  const byId = new Map(accounts.map((a) => [a.id as string, a]));
  const names: Record<string, string> = {};
  for (const a of accounts) {
    const parent = a.parent_id ? byId.get(a.parent_id as string) : undefined;
    names[a.id as string] = `${parent ? `${parent.name} › ` : ""}${a.name}`;
  }
  const top = (type: string, subtype: string) => (accounts.find((a) => a.type === type && a.subtype === subtype && !a.parent_id)?.id as string | undefined) ?? null;

  const bankAccounts = accounts
    .filter((a) => isCashLike({ isBank: a.is_bank as boolean, subtype: a.subtype as string | null }))
    .map((a) => ({ id: a.id as string, name: a.name as string, isProperty: a.property_id === property.id }));

  const ids = {
    recordedProceeds: (accounts.find((a) => a.name === "Sale Proceeds" && a.type === "equity")?.id as string | undefined) ?? "new-sale-proceeds",
    loan: top("liability", "loan"),
    deposits: top("liability", "deposits"),
    escrow: top("asset", "escrow"),
    gain: (accounts.find((a) => a.subtype === "sale_gain")?.id as string | undefined) ?? "new-sale-gain",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="rise space-y-1">
        {back}
        <h1 className="text-3xl font-semibold tracking-tight">Record the sale of {property.name}</h1>
        <p className="max-w-2xl text-muted">
          This takes the property&apos;s cost off your balance sheet, clears its loan, and books the gain or loss, all in one entry you can see before you save it.
        </p>
      </header>

      <div className="rise">
        <SaleDate propertyId={property.id} date={date} />
      </div>

      <div className="rise">
        <SaleForm key={date} propertyId={property.id} propertyName={property.name} date={date} facts={facts} names={names} bankAccounts={bankAccounts} ids={ids} />
      </div>
    </div>
  );
}
