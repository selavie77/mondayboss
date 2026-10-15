/** Ownership percentages are stored in basis points: 6000 = 60%, so shares never drift with floating point. */

export interface OwnerShare {
  entityId: string;
  percentBp: number;
}

/** "60", "33.33" or "60%" to basis points. Null when it is not a number from 0.01 to 100. */
export function percentToBp(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp > 0 && bp <= 10000 ? bp : null;
}

/** Basis points as a percentage without trailing zeros: 6000 -> "60", 3333 -> "33.33". */
export function bpToPercent(bp: number): string {
  return (bp / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** Why these owners cannot be saved, or null when they can. */
export function ownershipProblem(owners: OwnerShare[], primary: string): string | null {
  if (owners.length === 0) return "A property needs at least one owner.";
  if (new Set(owners.map((o) => o.entityId)).size !== owners.length) return "Each owner can be listed only once.";
  if (owners.some((o) => !(o.percentBp > 0))) return "Give each owner a percentage above zero.";
  const total = owners.reduce((s, o) => s + o.percentBp, 0);
  if (total !== 10000) return `The percentages add up to ${bpToPercent(total)}%. They must add up to 100%.`;
  if (!owners.some((o) => o.entityId === primary)) return "Choose which owner keeps the books.";
  return null;
}
