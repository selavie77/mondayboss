import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { isCashLike } from "@/lib/paidFrom";
import { getSession } from "@/lib/workspace";
import { ImportWizard, type CashAccountOption } from "./ImportWizard";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const { supabase } = await getSession();

  const [{ data: entities }, { data: portfolios }, { data: accts }, { data: history }, { data: props }] = await Promise.all([
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("portfolios").select("id, name").order("name"),
    supabase.from("accounts").select("id, code, name, last4, is_bank, subtype, property_id, portfolio_id").eq("is_active", true).order("code"),
    supabase.from("import_batch_summary").select("batch_id, source, filename, created_at, imported, posted, pending, ignored").order("created_at", { ascending: false }).limit(15),
    supabase.from("properties").select("id, name"),
  ]);

  const propName = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
  const portName = new Map((portfolios ?? []).map((p) => [p.id as string, p.name as string]));
  const accounts: CashAccountOption[] = (accts ?? [])
    .filter((a) => isCashLike({ isBank: a.is_bank, subtype: a.subtype }))
    .sort((a, b) => Number(b.is_bank) - Number(a.is_bank) || a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => ({
      id: a.id,
      name: a.name,
      last4: a.last4,
      isCard: !a.is_bank,
      scope: a.property_id ? (propName.get(a.property_id) ?? "A property") : a.portfolio_id ? `${portName.get(a.portfolio_id) ?? "A portfolio"} portfolio` : "All properties",
    }));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="rise">
        <h1 className="text-3xl font-semibold tracking-tight">Import</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Bring in your history and keep your books up to date. Anything unusual waits for you in Review, and re-uploading a file never creates duplicates.
        </p>
      </header>

      <div className="rise">
        <ImportWizard entities={entities ?? []} portfolios={portfolios ?? []} accounts={accounts} />
      </div>

      <section aria-labelledby="h-history" className="rise">
        <h2 id="h-history" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Import history
        </h2>
        <Card className="overflow-hidden">
          {(history ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">Nothing imported yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-muted">
                    <th scope="col" className="px-5 py-2.5">When</th>
                    <th scope="col" className="px-3 py-2.5">Source</th>
                    <th scope="col" className="px-3 py-2.5">File</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Imported</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Posted</th>
                    <th scope="col" className="px-5 py-2.5 text-right">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {history!.map((h) => (
                    <tr key={h.batch_id} className="border-t border-border/70">
                      <td className="whitespace-nowrap px-5 py-2.5">
                        {new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2.5">{h.source}</td>
                      <td className="max-w-xs truncate px-3 py-2.5 text-muted" title={h.filename ?? ""}>
                        {h.filename ?? "–"}
                      </td>
                      <td className="num px-3 py-2.5 text-right">{h.imported.toLocaleString("en-US")}</td>
                      <td className="num px-3 py-2.5 text-right">{h.posted.toLocaleString("en-US")}</td>
                      <td className="num px-5 py-2.5 text-right">
                        {h.pending > 0 ? (
                          <Link href="/review" className="font-semibold text-warning-fg underline underline-offset-2">
                            {h.pending.toLocaleString("en-US")}
                          </Link>
                        ) : (
                          "–"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
