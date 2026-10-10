import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/workspace";
import { EntityForm, PropertyForm } from "../forms";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const { entity } = await searchParams;
  const { supabase, firstName } = await getSession();

  const [{ data: entities }, { data: portfolios }, { count: propertyCount }] = await Promise.all([
    supabase.from("entities").select("id, name").order("created_at"),
    supabase.from("portfolios").select("id, name").order("created_at"),
    supabase.from("properties").select("id", { count: "exact", head: true }),
  ]);

  if ((propertyCount ?? 0) > 0 && !entity) redirect("/monday");

  const hasEntity = (entities?.length ?? 0) > 0;
  const step = hasEntity ? 2 : 1;
  const steps = ["Who owns it", "Your first property", "All set"];

  return (
    <div className="mx-auto max-w-xl rise">
      <p className="text-sm font-medium text-brand-700">Welcome{firstName ? `, ${firstName}` : ""}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {step === 1 ? "First, who owns your rentals?" : "Now add your first property"}
      </h1>
      <p className="mb-8 mt-2 text-muted">
        {step === 1
          ? "Each entity gets its own set of books and tax forms. You can add more later."
          : "You can group properties into portfolios and import the rest from Stessa in a moment."}
      </p>

      <ol className="mb-8 flex items-center gap-2 text-sm" aria-label="Progress">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                  done ? "bg-brand-600 text-white" : current ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500" : "bg-border text-muted"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
              </span>
              <span className={current ? "font-medium" : "text-muted"}>{label}</span>
              {n < steps.length && <span className="mx-1 h-px w-6 bg-border-strong" aria-hidden />}
            </li>
          );
        })}
      </ol>

      <Card className="p-6 sm:p-8">
        {step === 1 ? (
          <EntityForm />
        ) : (
          <PropertyForm entities={entities ?? []} portfolios={portfolios ?? []} defaultEntityId={entity as string | undefined} />
        )}
      </Card>
    </div>
  );
}
