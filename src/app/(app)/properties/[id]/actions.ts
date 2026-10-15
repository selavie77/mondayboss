"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { ownershipProblem } from "@/lib/ownership";
import { getSession } from "@/lib/workspace";

export type PropertyResult = { error?: string; ok?: true };

const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable();
const day = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter dates as year-month-day.")
  .nullable();

const details = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Give the property a name.").max(120),
  rentalType: z.enum(["long_term", "short_term", "mixed", "owner_occupied"]),
  portfolioId: z.uuid("Choose a portfolio."),
  address: text(200),
  city: text(80),
  state: z.string().trim().max(2, "Use the 2-letter state code.").transform((v) => (v === "" ? null : v.toUpperCase())).nullable(),
  postalCode: text(20),
  acquiredOn: day,
  placedInServiceOn: day,
  purchasePrice: z.string().trim().max(40),
});

function refresh(id: string) {
  for (const p of ["/properties", `/properties/${id}`, "/portfolios", "/entities", "/monday"]) revalidatePath(p);
  revalidatePath("/reports", "layout");
}

/** Save a property's details, including which portfolio it is in. Who owns it is changed separately. */
export async function updateProperty(input: unknown): Promise<PropertyResult> {
  const parsed = details.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something is wrong with the form." };
  const d = parsed.data;

  let price: number | null = null;
  if (d.purchasePrice !== "") {
    try {
      price = toCents(d.purchasePrice);
    } catch {
      return { error: "Enter the purchase price as a number, like 250,000." };
    }
    if (price < 0) return { error: "The purchase price cannot be negative." };
  }

  const { supabase } = await getSession();
  const { data, error } = await supabase
    .from("properties")
    .update({
      name: d.name,
      rental_type: d.rentalType,
      portfolio_id: d.portfolioId,
      address_line1: d.address,
      city: d.city,
      state: d.state,
      postal_code: d.postalCode,
      acquired_on: d.acquiredOn,
      placed_in_service_on: d.placedInServiceOn,
      purchase_price_cents: price,
    })
    .eq("id", d.id)
    .select("id");
  if (error) return { error: error.code === "23505" ? "You already have a property with that name." : error.message };
  if (!data?.length) return { error: "That property was not found." };

  refresh(d.id);
  return { ok: true };
}

const owners = z.object({
  id: z.uuid(),
  primary: z.uuid(),
  owners: z.array(z.object({ entityId: z.uuid(), percentBp: z.number().int().min(1).max(10000) })).min(1).max(20),
});

/** Replace a property's owners and their percentages. */
export async function saveOwners(input: unknown): Promise<PropertyResult> {
  const parsed = owners.safeParse(input);
  if (!parsed.success) return { error: "Check the owners and percentages." };
  const { id, primary, owners: list } = parsed.data;

  const problem = ownershipProblem(list, primary);
  if (problem) return { error: problem };

  const { supabase } = await getSession();
  const { error } = await supabase.rpc("set_property_owners", {
    p_property_id: id,
    p_primary: primary,
    p_owners: list.map((o) => ({ entity_id: o.entityId, percent_bp: o.percentBp })),
  });
  if (error) return { error: error.message };

  refresh(id);
  return { ok: true };
}
