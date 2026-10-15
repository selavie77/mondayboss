"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/workspace";

export type PortfolioResult = { error?: string; ok?: true };

const name = z.string().trim().min(1, "Give the portfolio a name.").max(60, "Keep the name under 60 characters.");
const entity = z.uuid().nullable();

function refresh() {
  for (const p of ["/portfolios", "/properties", "/import", "/monday"]) revalidatePath(p);
  revalidatePath("/reports", "layout");
}

/** Create a portfolio, optionally with a default owner for the properties added to it. */
export async function addPortfolio(input: unknown): Promise<PortfolioResult> {
  const parsed = z.object({ name, defaultEntityId: entity }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something is wrong with the form." };

  const { supabase, workspaceId } = await getSession();
  const { error } = await supabase.from("portfolios").insert({ workspace_id: workspaceId, name: parsed.data.name, default_entity_id: parsed.data.defaultEntityId });
  if (error) return { error: error.code === "23505" ? "You already have a portfolio with that name." : error.message };

  refresh();
  return { ok: true };
}

/** Rename a portfolio or change its default owner. Properties already in it keep their owners. */
export async function updatePortfolio(input: unknown): Promise<PortfolioResult> {
  const parsed = z.object({ id: z.uuid(), name, defaultEntityId: entity }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something is wrong with the form." };

  const { supabase } = await getSession();
  const { data, error } = await supabase
    .from("portfolios")
    .update({ name: parsed.data.name, default_entity_id: parsed.data.defaultEntityId })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return { error: error.code === "23505" ? "You already have a portfolio with that name." : error.message };
  if (!data?.length) return { error: "That portfolio was not found." };

  refresh();
  return { ok: true };
}

/** Delete a portfolio that has no properties in it. */
export async function deletePortfolio(id: string): Promise<PortfolioResult> {
  if (!z.uuid().safeParse(id).success) return { error: "That portfolio was not found." };
  const { supabase } = await getSession();

  const { count } = await supabase.from("properties").select("id", { count: "exact", head: true }).eq("portfolio_id", id);
  if ((count ?? 0) > 0) return { error: `Move its ${count} ${count === 1 ? "property" : "properties"} to another portfolio first.` };
  const { count: accounts } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("portfolio_id", id);
  if ((accounts ?? 0) > 0) return { error: "A bank account or card is tied to this portfolio. Change that on the Categories page first." };

  const { error } = await supabase.from("portfolios").delete().eq("id", id);
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}
