import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user plus their (first) workspace. Redirects to /login if signed out. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/login");

  const workspace = membership.workspaces as unknown as { name: string } | null;
  return {
    supabase,
    user,
    workspaceId: membership.workspace_id as string,
    workspaceName: workspace?.name ?? "My workspace",
    firstName: ((user.user_metadata?.full_name as string | undefined) ?? user.email ?? "").split(/[ @]/)[0],
  };
});
