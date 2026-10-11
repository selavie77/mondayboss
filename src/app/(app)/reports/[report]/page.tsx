import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/workspace";
import { findReport } from "@/lib/reports/catalog";
import { loadCapex, loadLedger, loadReport, selectProperties } from "@/lib/reports/load";
import { parseParams } from "@/lib/reports/params";
import type { ReportKind } from "@/lib/reports/types";
import { AddCapex } from "../AddCapex";
import { CapexTable } from "../CapexTable";
import { LedgerTable } from "../LedgerTable";
import { ReportControls } from "../ReportControls";
import { ReportTable } from "../ReportTable";
import { StarButton } from "../StarButton";
import { VisitPing } from "../VisitPing";

export async function generateMetadata({ params }: PageProps<"/reports/[report]">): Promise<Metadata> {
  const { report } = await params;
  return { title: findReport(report)?.name ?? "Report" };
}

export default async function ReportPage({ params: routeParams, searchParams }: PageProps<"/reports/[report]">) {
  const { report: key } = await routeParams;
  const item = findReport(key);
  if (!item) notFound();

  const sp = await searchParams;
  const { supabase } = await getSession();

  // Default to the most recent year that has entries, and offer every year with entries.
  const [{ count: pendingCount }, { data: dates }, { data: oldest }, { data: portfolios }, { data: pref }, props, { data: entityRows }] = await Promise.all([
    supabase.from("statement_lines").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("journal_entries").select("entry_date").order("entry_date", { ascending: false }).limit(1),
    supabase.from("journal_entries").select("entry_date").order("entry_date").limit(1),
    supabase.from("portfolios").select("id, name").order("name"),
    supabase.from("report_prefs").select("is_favorite").eq("report_key", key).maybeSingle(),
    selectProperties("all"),
    supabase.from("entities").select("id, name").order("name"),
  ]);
  const latest = dates?.[0]?.entry_date ? Number(dates[0].entry_date.slice(0, 4)) : new Date().getFullYear();
  const first = oldest?.[0]?.entry_date ? Number(oldest[0].entry_date.slice(0, 4)) : latest;
  const years = Array.from({ length: Math.max(1, latest - first + 1) }, (_, i) => latest - i);

  const params = parseParams(sp, latest, key as ReportKind);
  const isCapex = params.report === "capital-expenses";
  const isLedger = params.report === "general-ledger";
  const [report, capex, ledger] = await Promise.all([
    isCapex || isLedger ? null : loadReport(params),
    isCapex ? loadCapex(params) : null,
    isLedger ? loadLedger(params) : null,
  ]);

  const defaultProperty = params.property.startsWith("p:") ? params.property.slice(2) : undefined;

  return (
    <div className="space-y-4">
      <VisitPing reportKey={key} />
      <header className="rise print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Reports
        </Link>
        <div className="mt-1 flex items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
          <StarButton reportKey={key} initial={pref?.is_favorite ?? false} />
        </div>
        <p className="text-sm text-muted">{item.description}</p>
      </header>

      <div className="rise">
        <ReportControls
          params={params}
          options={{
            properties: props.all.map((p) => ({ id: p.id, name: p.name })),
            portfolios: portfolios ?? [],
            years,
            accounts: ledger?.accountOptions,
            entities: (entityRows ?? []) as { id: string; name: string }[],
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
        {ledger && <LedgerTable report={ledger} />}
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
