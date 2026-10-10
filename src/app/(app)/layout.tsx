import { Logo } from "@/components/ui";
import { getSession } from "@/lib/workspace";
import { signOut } from "../(auth)/actions";
import { Nav } from "./Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspaceName } = await getSession();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:py-6">
          <Logo />
        </div>
        <Nav />
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
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
