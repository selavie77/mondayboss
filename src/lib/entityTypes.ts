export const ENTITY_TYPES = [
  { value: "llc", label: "LLC" },
  { value: "individual", label: "Individual (personal name)" },
  { value: "s_corp", label: "S corporation" },
  { value: "c_corp", label: "C corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust", label: "Trust" },
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number]["value"];

export const entityTypeLabel = (value: string) => ENTITY_TYPES.find((t) => t.value === value)?.label ?? value;
