import type { StessaRow } from "./stessa";

/** Account codes from seed_default_chart(). */
export const CODES = {
  cash: "1000",
  escrow: "1100",
  deposits: "2000",
  mortgage: "2100",
  contributions: "3000",
  distributions: "3100",
  rent: "4000",
  section8: "4010",
  otherIncome: "4100",
  cleaning: "5020",
  commissions: "5030",
  insurance: "5040",
  professional: "5050",
  management: "5060",
  mortgageInterest: "5070",
  repairs: "5090",
  supplies: "5100",
  propertyTax: "5110",
  utilities: "5120",
  otherExpense: "5140",
} as const;

/** Key for an account: a code ("5090"), or a subcategory under a category ("5090::Plumbing Repairs"). */
export const SUB_SEP = "::";
export const acctKey = (code: string, sub?: string | null) => (sub ? `${code}${SUB_SEP}${sub}` : code);

/** Plain-English descriptions for subcategories created from Stessa sub-categories. */
export const SUB_DESCRIPTIONS: Record<string, string> = {
  "Eviction Fees": "Court and filing costs for evicting a tenant.",
  "HVAC Repairs": "Heating and cooling repairs.",
  "Plumbing Repairs": "Leaks, clogs, water heaters and other plumbing fixes.",
  Labor: "Hired labor for repairs and maintenance.",
  "Electrical Repairs": "Wiring, outlets, fixtures and other electrical fixes.",
  "Roof Repairs": "Patching and repairing a roof. A full replacement is usually an improvement, not a repair.",
  "Tax Licenses & Registrations": "Rental licenses, registrations and permits.",
  "Water & Sewer": "Water and sewer charges for the property.",
  Electric: "Electric service for the property.",
  "Bank Fees": "Monthly account, wire and similar bank fees.",
};

export interface Mapped {
  /** Account on the other side of cash (cash is debited for money in, credited for money out). */
  counterCode: string;
  /** Subcategory under `counterCode`, created on demand. Absent means the amount belongs to the category itself. */
  sub?: string;
  /** Fixed debit/credit accounts that ignore the sign of the amount (non-cash movements). */
  fixed?: { debitCode: string; creditCode: string };
  /** Mapped, but a human should look at it. */
  review?: string;
}

export interface Unresolved {
  reason: string;
}

const REPAIRS_TO_CLEANING = new Set(["Gardening & Landscaping"]);
const REPAIRS_TO_SUPPLIES = new Set(["R&M Supplies"]);

export function mapStessaRow(row: StessaRow): Mapped | Unresolved {
  const { category: cat, subCategory: sub, notes, name } = row;
  const hint = `${notes} ${name}`.toLowerCase();

  switch (cat) {
    case "Income":
      if (sub === "Rents") return { counterCode: CODES.rent };
      if (sub === "Section 8 Rents") return { counterCode: CODES.section8 };
      if (sub === "Late Fees") return { counterCode: CODES.otherIncome };
      return { counterCode: CODES.rent };

    case "Management Fees":
      if (sub === "Leasing Commissions") return { counterCode: CODES.commissions };
      return { counterCode: CODES.management };

    case "Mortgages & Loans":
      if (sub === "Mortgage Interest") return { counterCode: CODES.mortgageInterest };
      if (sub === "Mortgage Principal") return { counterCode: CODES.mortgage };
      return { reason: "Combined mortgage payment; needs a principal/interest/escrow split" };

    case "Transfers":
      if (sub === "Owner Distributions") return { counterCode: CODES.distributions };
      if (sub === "Owner Contributions") return { counterCode: CODES.contributions };
      if (sub === "Property Tax Escrows") return { counterCode: CODES.escrow };
      if (sub === "General Escrow Payments") {
        if (hint.includes("tax disbursement")) {
          // Servicer paid property tax out of escrow: expense it and relieve escrow. No cash moves.
          return {
            counterCode: CODES.propertyTax,
            fixed: { debitCode: CODES.propertyTax, creditCode: CODES.escrow },
            review: "Property tax paid from escrow",
          };
        }
        return { counterCode: CODES.escrow, review: "Escrow refund or other disbursement" };
      }
      return { reason: "Transfer with no sub-category" };

    case "Repairs & Maintenance":
      if (sub && REPAIRS_TO_CLEANING.has(sub)) return { counterCode: CODES.cleaning };
      if (sub && REPAIRS_TO_SUPPLIES.has(sub)) return { counterCode: CODES.supplies };
      return { counterCode: CODES.repairs, sub: sub ?? undefined };

    // With no sub-category the amount simply belongs to the main category; totals roll up.
    case "Utilities":
      return { counterCode: CODES.utilities, sub: sub ?? undefined };
    case "Insurance":
      return { counterCode: CODES.insurance, sub: sub ?? undefined };
    case "Legal & Professional":
      return { counterCode: CODES.professional, sub: sub ?? undefined };
    case "Taxes":
      return { counterCode: CODES.propertyTax, sub: sub ?? undefined };
    case "Admin & Other":
      return { counterCode: CODES.otherExpense, sub: sub ?? undefined };
    case "Security Deposits":
      return { counterCode: CODES.deposits };
    default:
      return { reason: `Unknown category: ${cat ?? "(none)"} / ${sub ?? "(none)"}` };
  }
}

export function isUnresolved(m: Mapped | Unresolved): m is Unresolved {
  return "reason" in m;
}

/** Sign sanity checks that hint at mis-categorised rows. */
export function signWarning(row: StessaRow): string | undefined {
  const { category: cat, amountCents } = row;
  if (cat === "Income" && amountCents < 0) return "Negative income (refund or reversal?)";
  if (cat && ["Utilities", "Insurance", "Repairs & Maintenance", "Management Fees"].includes(cat) && amountCents > 0) {
    return "Positive expense (refund?)";
  }
  return undefined;
}
