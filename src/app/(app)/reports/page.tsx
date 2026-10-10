import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CATALOG, CATEGORIES } from "@/lib/reports/catalog";
import { getSession } from "@/lib/workspace";
import { ReportsCenter, type CenterItem } from "./ReportsCenter";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsCenterPage({ searchParams }: PageProps<"/reports">) {
  const sp = await searchParams;

  // Old links used /reports?report=income-statement&...; send them to the report itself.
  if (typeof sp.report === "string" && CATALOG.some((r) => r.key === sp.report && r.available)) {
    const rest = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "report" && typeof v === "string") rest.set(k, v);
    const qs = rest.toString();
    redirect(`/reports/${sp.report}${qs ? `?${qs}` : ""}`);
  }

  const { supabase } = await getSession();
  const { data: prefs } = await supabase.from("report_prefs").select("report_key, is_favorite, last_visited_at");
  const byKey = new Map((prefs ?? []).map((p) => [p.report_key as string, p]));

  const items: CenterItem[] = CATALOG.map((r) => ({
    ...r,
    favorite: byKey.get(r.key)?.is_favorite ?? false,
    lastVisited: (byKey.get(r.key)?.last_visited_at as string | null | undefined) ?? null,
  }));

  const view = sp.view === "favorites" ? "favorites" : "all";
  const category = typeof sp.category === "string" && CATEGORIES.some((c) => c.key === sp.category) ? sp.category : null;

  return (
    <div className="space-y-4">
      <header className="rise">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      </header>
      <div className="rise">
        <ReportsCenter key={`${view}-${category}`} items={items} view={view} category={category} />
      </div>
    </div>
  );
}
