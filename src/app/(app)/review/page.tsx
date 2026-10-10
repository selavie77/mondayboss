import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/workspace";
import { ReviewList, type AccountOption, type ReviewItem } from "./ReviewList";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage() {
  const { supabase } = await getSession();

  const { data: lines } = await supabase
    .from("statement_lines")
    .select(
      "id, entity_id, txn_date, description, amount_cents, raw, review_reason, proposed_debit_account_id, proposed_credit_account_id, properties(name)",
    )
    .eq("status", "pending")
    .order("txn_date", { ascending: false })
    .limit(1000);

  const entityIds = [...new Set((lines ?? []).map((l) => l.entity_id as string))];
  const { data: accounts } = entityIds.length
    ? await supabase
        .from("accounts")
        .select("id, entity_id, parent_id, code, name, type, is_bank")
        .in("entity_id", entityIds)
        .eq("is_active", true)
        .order("code")
    : { data: [] };

  const accountOptions: AccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    entityId: a.entity_id,
    parentId: a.parent_id,
    code: a.code,
    name: a.name,
    type: a.type,
    isBank: a.is_bank,
  }));
  const byId = new Map(accountOptions.map((a) => [a.id, a]));
  const label = (id: string | null) => {
    const a = id ? byId.get(id) : undefined;
    if (!a) return null;
    const parent = a.parentId ? byId.get(a.parentId) : undefined;
    return parent ? `${parent.name} › ${a.name}` : `${a.code} ${a.name}`;
  };

  const items: ReviewItem[] = (lines ?? []).map((l) => {
    const raw = (l.raw ?? {}) as { category?: string | null; subCategory?: string | null };
    const amount = Number(l.amount_cents);
    const property = l.properties as unknown as { name: string } | null;
    return {
      id: l.id,
      entityId: l.entity_id,
      date: l.txn_date,
      description: l.description,
      amountCents: amount,
      property: property?.name ?? "",
      source: [raw.category, raw.subCategory].filter(Boolean).join(" › "),
      reason: l.review_reason ?? "Needs a category",
      proposalDebit: label(l.proposed_debit_account_id),
      proposalCredit: label(l.proposed_credit_account_id),
      hasProposal: Boolean(l.proposed_debit_account_id && l.proposed_credit_account_id),
      isMortgage: raw.category === "Mortgages & Loans",
    };
  });

  return (
    <div className="space-y-8">
      <header className="rise">
        <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
        <p className="mt-1 text-muted">
          {items.length === 0
            ? "Everything imported has been sorted into your books."
            : `${items.length} imported transaction${items.length === 1 ? "" : "s"} need a quick look before they reach your books.`}
        </p>
      </header>

      {items.length === 0 ? (
        <Card className="rise flex flex-col items-center gap-3 p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-lg font-medium">Nothing to review</p>
          <p className="max-w-sm text-sm text-muted">New imports that look unusual will wait for you here.</p>
        </Card>
      ) : (
        <ReviewList items={items} accounts={accountOptions} />
      )}
    </div>
  );
}
