import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/ui";

const points = [
  "True double-entry books, not just a tracker",
  "Every portfolio, entity and property in one place",
  "Reconcile to your statements and know it's right",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-400 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-900/30 blur-3xl"
        />
        <Logo size="lg" invert />
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Make Monday the calmest day of your week.</h2>
          <p className="mt-4 text-lg text-white/80">
            Accurate books for rental owners, without the spreadsheets or the Sunday-night dread.
          </p>
          <ul className="mt-8 space-y-3.5">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] text-white/90">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-100" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/60">© {new Date().getFullYear()} Mondayboss</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="rise w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
