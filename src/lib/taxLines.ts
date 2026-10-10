/** Schedule E lines an income or expense category can roll up to. */
export const SCHEDULE_E_LINES: { value: string; label: string; kind: "income" | "expense" }[] = [
  { value: "sched_e.rents_received", label: "Rents received", kind: "income" },
  { value: "sched_e.advertising", label: "Advertising", kind: "expense" },
  { value: "sched_e.auto_travel", label: "Auto and travel", kind: "expense" },
  { value: "sched_e.cleaning_maintenance", label: "Cleaning and maintenance", kind: "expense" },
  { value: "sched_e.commissions", label: "Commissions", kind: "expense" },
  { value: "sched_e.insurance", label: "Insurance", kind: "expense" },
  { value: "sched_e.legal_professional", label: "Legal and other professional fees", kind: "expense" },
  { value: "sched_e.management_fees", label: "Management fees", kind: "expense" },
  { value: "sched_e.mortgage_interest", label: "Mortgage interest", kind: "expense" },
  { value: "sched_e.other_interest", label: "Other interest", kind: "expense" },
  { value: "sched_e.repairs", label: "Repairs", kind: "expense" },
  { value: "sched_e.supplies", label: "Supplies", kind: "expense" },
  { value: "sched_e.taxes", label: "Taxes", kind: "expense" },
  { value: "sched_e.utilities", label: "Utilities", kind: "expense" },
  { value: "sched_e.depreciation", label: "Depreciation", kind: "expense" },
  { value: "sched_e.other", label: "Other expenses", kind: "expense" },
];

export const taxLineLabel = (value: string | null) => SCHEDULE_E_LINES.find((l) => l.value === value)?.label ?? null;
