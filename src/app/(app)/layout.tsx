import { Logo } from "@/components/ui";
import { getSession } from "@/lib/workspace";
import { signOut } from "../(auth)/actions";
import { Nav } from "./Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, workspaceName } = await getSession();
  const { count: reviewCount } = await supabase
    .from("statement_lines")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="border-b border-border bg-surface print:hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:py-6">
          <Logo />
        </div>
        <Nav reviewCount={reviewCount ?? 0} />
        <div className="hidden border-t border-border p-4 lg:mt-auto lg:block">
          <p className="truncate text-sm font-medium">{workspaceName}</p>
          <p className="truncate text-[13px] text-muted">{user.email}</p>
          <form action={signOut} className="mt-3">
            <button type="submit" className="text-sm font-medium text-brand-700 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="px-5 py-8 sm:px-10 lg:py-12">
        <div className="mx-auto max-w-[100rem]">{children}</div>
      </main>
    </div>
  );
}
