import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowRight, ArrowUpRight, CheckCircle2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Card } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { getSession } from "@/lib/workspace";

export const metadata: Metadata = { title: "Monday" };

interface Attention {
  title: string;
  detail: string;
  href: string;
  cta: string;
}

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function MondayPage({ searchParams }: PageProps<"/monday">) {
  const { year: yearParam } = await searchParams;
  const { supabase, firstName } = await getSession();
  const now = new Date();

  const [entities, properties, summary, pending, recons, entries, openings, undone] = await Promise.all([
    supabase.from("entities").select("id", { count: "exact", head: true }),
    supabase.from("properties").select("id, name, rental_type, portfolios(name)").order("name"),
    supabase.from("property_summary_yearly").select("property_id, year, income_cents, expense_cents"),
    supabase.from("statement_lines").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("reconciliations").select("id", { count: "exact", head: true }),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("source", "system").like("memo", "Opening balance:%"),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("source", "reversal").like("memo", "Reversal of Opening balance:%"),
  ]);

  const rows = (summary.data ?? []).map((r) => ({ ...r, income: Number(r.income_cents), expense: Number(r.expense_cents) }));
  const years = [...new Set(rows.map((r) => r.year as number))].sort((a, b) => b - a);
  const requested = Number(yearParam);
  const year = years.includes(requested) ? requested : (years[0] ?? now.getFullYear());

  const byProperty = new Map<string, { income: number; expense: number }>();
  for (const r of rows.filter((r) => r.year === year)) {
    const cur = byProperty.get(r.property_id as string) ?? { income: 0, expense: 0 };
    cur.income += r.income;
    cur.expense += r.expense;
    byProperty.set(r.property_id as string, cur);
  }
  const totals = [...byProperty.values()].reduce((a, p) => ({ income: a.income + p.income, expense: a.expense + p.expense }), {
    income: 0,
    expense: 0,
  });
  const net = totals.income - totals.expense;

  const attention: Attention[] = [];
  if ((entities.count ?? 0) === 0) {
    attention.push({ title: "Set up who owns your rentals", detail: "Add your first entity to start your books.", href: "/onboarding", cta: "Get started" });
  } else if ((properties.data?.length ?? 0) === 0) {
    attention.push({ title: "Add your first property", detail: "Properties are where income and expenses are tracked.", href: "/properties", cta: "Add property" });
  }
  if ((pending.count ?? 0) > 0) {
    attention.push({ title: `${pending.count} transactions are waiting for review`, detail: "Confirm or change the category so they reach your books.", href: "/review", cta: "Review" });
  }
  if ((entries.count ?? 0) > 0 && (openings.count ?? 0) - (undone.count ?? 0) <= 0) {
    attention.push({ title: "Add your bank accounts and opening balances", detail: "Create your bank accounts and credit cards in Categories and enter what each held when your books begin.", href: "/categories", cta: "Set up" });
  }
  if ((entries.count ?? 0) > 0 && (recons.count ?? 0) === 0) {
    attention.push({ title: "Reconcile your accounts", detail: "Compare your books to a bank statement to prove they're right.", href: "#", cta: "Start" });
  }

  const propertyRows = (properties.data ?? []).map((p) => {
    const t = byProperty.get(p.id) ?? { income: 0, expense: 0 };
    const portfolio = p.portfolios as unknown as { name: string } | null;
    return { id: p.id, name: p.name, portfolio: portfolio?.name ?? "", ...t, net: t.income - t.expense };
  });
  const maxIncome = Math.max(1, ...propertyRows.map((p) => p.income));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {greeting(now)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        {years.length > 0 && (
          <nav aria-label="Year" className="flex gap-1 rounded-xl border border-border bg-surface p-1">
            {years.map((y) => (
              <Link
                key={y}
                href={`/monday?year=${y}`}
                aria-current={y === year ? "true" : undefined}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                  y === year ? "bg-brand-600 text-white" : "text-muted hover:text-foreground"
                }`}
              >
                {y}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <section aria-labelledby="attention" className="rise" style={{ animationDelay: "60ms" }}>
        <h2 id="attention" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Needs you this week
        </h2>
        {attention.length === 0 ? (
          <Card className="flex items-center gap-4 p-5">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-600">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-medium">You&apos;re all caught up</p>
              <p className="text-sm text-muted">Nothing needs your attention right now. Enjoy your Monday.</p>
            </div>
          </Card>
        ) : (
          <ul className="space-y-3">
            {attention.map((a) => (
              <li key={a.title}>
                <Card className="flex flex-wrap items-center gap-4 p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-warning-bg text-warning-fg">
                    <AlertCircle className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-sm text-muted">{a.detail}</p>
                  </div>
                  <Link
                    href={a.href}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    {a.cta} <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={`${year} summary`} className="rise grid gap-4 sm:grid-cols-3" style={{ animationDelay: "120ms" }}>
        <Stat label="Income" value={totals.income} icon={<TrendingUp className="h-4 w-4" aria-hidden />} />
        <Stat label="Expenses" value={totals.expense} icon={<TrendingDown className="h-4 w-4" aria-hidden />} />
        <Stat label="Net income" value={net} icon={<Wallet className="h-4 w-4" aria-hidden />} emphasis tone={net >= 0 ? "pos" : "neg"} />
      </section>

      <section aria-labelledby="props" className="rise" style={{ animationDelay: "180ms" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id="props" className="text-sm font-semibold uppercase tracking-wide text-muted">
            Properties · {year}
          </h2>
          <Link href="/properties" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            Manage <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <Card className="overflow-hidden">
          {propertyRows.length === 0 ? (
            <p className="p-8 text-center text-muted">Your properties will show up here.</p>
          ) : (
            <ul className="divide-y divide-border">
              {propertyRows.map((p) => (
                <li key={p.id} className="grid items-center gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[1.4fr_1.6fr_auto]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-[13px] text-muted">{p.portfolio}</p>
                  </div>
                  <div aria-hidden className="hidden h-2 overflow-hidden rounded-full bg-brand-50 sm:block">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.max(2, (p.income / maxIncome) * 100)}%` }} />
                  </div>
                  <div className="text-right">
                    <p className={`num font-semibold ${p.net < 0 ? "text-negative" : ""}`}>{formatCents(p.net)}</p>
                    <p className="num text-[13px] text-muted">{formatCents(p.income)} in</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  emphasis,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  emphasis?: boolean;
  tone?: "pos" | "neg";
}) {
  return (
    <Card className={`p-5 ${emphasis ? "bg-gradient-to-br from-brand-50 to-surface" : ""}`}>
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
        {label}
      </p>
      <p className={`num mt-3 text-3xl font-semibold tracking-tight ${tone === "neg" ? "text-negative" : ""}`}>{formatCents(value)}</p>
    </Card>
  );
}
