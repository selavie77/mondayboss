import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { getSession } from "@/lib/workspace";
import { loadCapex, loadReport, selectProperties } from "@/lib/reports/load";
import { parseParams } from "@/lib/reports/params";
import { AddCapex } from "./AddCapex";
import { CapexTable } from "./CapexTable";
import { ReportControls } from "./ReportControls";
import { ReportTable } from "./ReportTable";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const sp = await searchParams;
  const { supabase } = await getSession();

  // Default to the most recent year that has entries, and offer every year with entries.
  const [{ count: pendingCount }, { data: dates }, { data: portfolios }, props] = await Promise.all([
    supabase.from("statement_lines").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("journal_entries").select("entry_date").order("entry_date", { ascending: false }).limit(1),
    supabase.from("portfolios").select("id, name").order("name"),
    selectProperties("all"),
  ]);
  const latest = dates?.[0]?.entry_date ? Number(dates[0].entry_date.slice(0, 4)) : new Date().getFullYear();
  const { data: oldest } = await supabase.from("journal_entries").select("entry_date").order("entry_date").limit(1);
  const first = oldest?.[0]?.entry_date ? Number(oldest[0].entry_date.slice(0, 4)) : latest;
  const years = Array.from({ length: Math.max(1, latest - first + 1) }, (_, i) => latest - i);

  const params = parseParams(sp, latest);
  const isCapex = params.report === "capital-expenses";
  const [report, capex] = await Promise.all([
    isCapex ? null : loadReport(params),
    isCapex ? loadCapex(params) : null,
  ]);

  const defaultProperty = params.property.startsWith("p:") ? params.property.slice(2) : undefined;

  return (
    <div className="space-y-4">
      <header className="rise">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      </header>

      <div className="rise">
        <ReportControls
          params={params}
          options={{
            properties: props.all.map((p) => ({ id: p.id, name: p.name })),
            portfolios: portfolios ?? [],
            years,
          }}
        />
      </div>

      {(pendingCount ?? 0) > 0 && !isCapex && (
        <div role="status" className="rise flex flex-wrap items-center gap-3 rounded-xl bg-warning-bg px-4 py-2 text-[13px] text-warning-fg print:hidden">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          <p className="flex-1">
            <strong>{pendingCount} imported transactions</strong> are still waiting for review, so these numbers don&apos;t include them yet.
          </p>
          <Link href="/review" className="font-semibold underline underline-offset-2">
            Review now
          </Link>
        </div>
      )}

      <div className="rise space-y-4">
        {report && <ReportTable data={report} cents={params.cents} />}
        {capex && (
          <>
            <CapexTable {...capex} />
            <AddCapex properties={props.all.map((p) => ({ id: p.id, name: p.name }))} defaultPropertyId={defaultProperty} />
          </>
        )}
      </div>
    </div>
  );
}
