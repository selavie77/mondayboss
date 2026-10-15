"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/workspace";

export type FormState = { error?: string } | undefined;

const entitySchema = z.object({
  name: z.string().trim().min(1, "Give the entity a name."),
  type: z.enum(["individual", "llc", "s_corp", "c_corp", "partnership", "trust"]),
});

export async function createEntity(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, workspaceId } = await getSession();
  const parsed = entitySchema.safeParse({ name: formData.get("name"), type: formData.get("type") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data, error } = await supabase
    .from("entities")
    .insert({ workspace_id: workspaceId, ...parsed.data })
    .select("id")
    .single();
  if (error) {
    return { error: error.code === "23505" ? "You already have an entity with that name." : error.message };
  }

  const seeded = await supabase.rpc("seed_default_chart", { p_entity_id: data.id });
  if (seeded.error) return { error: seeded.error.message };

  revalidatePath("/", "layout");
  redirect(formData.get("next") === "entities" ? "/entities" : `/onboarding?entity=${data.id}`);
}

const propertySchema = z.object({
  name: z.string().trim().min(1, "Give the property a name."),
  entity_id: z.uuid("Choose which entity owns it."),
  portfolio_id: z.string().optional(),
  new_portfolio: z.string().trim().optional(),
  address_line1: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().max(2, "Use the 2-letter state code.").optional(),
  postal_code: z.string().trim().optional(),
  rental_type: z.enum(["long_term", "short_term", "mixed", "owner_occupied"]),
});

export async function createProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, workspaceId } = await getSession();
  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { new_portfolio, portfolio_id, ...rest } = parsed.data;

  let portfolioId = portfolio_id;
  if (new_portfolio) {
    const { data, error } = await supabase
      .from("portfolios")
      .insert({ workspace_id: workspaceId, name: new_portfolio })
      .select("id")
      .single();
    if (error) {
      return { error: error.code === "23505" ? "You already have a portfolio with that name." : error.message };
    }
    portfolioId = data.id;
  }
  if (!portfolioId) return { error: "Choose a portfolio or name a new one." };

  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== "" && v !== undefined));
  const { error } = await supabase
    .from("properties")
    .insert({ workspace_id: workspaceId, portfolio_id: portfolioId, ...clean } as never);
  if (error) {
    return { error: error.code === "23505" ? "You already have a property with that name." : error.message };
  }

  revalidatePath("/", "layout");
  redirect("/monday");
}
