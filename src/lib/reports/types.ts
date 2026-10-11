export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface AccountInfo {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  isBank: boolean;
}

/** Net debit-minus-credit for one account in one report column. */
export interface ActivityRow {
  columnKey: string;
  accountId: string;
  netCents: number;
}

export interface Column {
  key: string;
  label: string;
}

export type RowKind = "heading" | "line" | "subline" | "total" | "grand" | "ratio" | "gap";

export interface ReportRow {
  kind: RowKind;
  label: string;
  /** The section (heading) this row sits under; absent for rows outside any section. */
  section?: string;
  /** Set on the lines of a category that has subcategories, so they can be collapsed to the category total. */
  cat?: string;
  /** True on the category total row, which stays visible when the category is collapsed. */
  catHead?: boolean;
  /** The category's own name, shown on its total row when collapsed. */
  catName?: string;
  /** True on a section's total row, which stays visible when the section is collapsed. */
  summary?: boolean;
  /** One value per column (plus a trailing total when enabled). Cents, or a plain ratio for kind "ratio". */
  values?: (number | null)[];
}

export interface ReportNote {
  tone: "ok" | "warn" | "info";
  text: string;
  link?: { href: string; label: string };
}

export interface ReportData {
  title: string;
  subtitle: string;
  /** Short messages shown above the table (e.g. "Debits equal credits"). */
  notes?: ReportNote[];
  columns: string[];
  rows: ReportRow[];
  empty: boolean;
}

export interface BuildOptions {
  /** "category" hides subcategory lines; "sub" shows them under each category. */
  detail: "category" | "sub";
  /** Append a Total column. */
  showTotal: boolean;
}

export type ReportKind =
  | "income-statement"
  | "net-cash-flow"
  | "capital-expenses"
  | "balance-sheet"
  | "trial-balance"
  | "general-ledger";
export type ColumnGrouping = "property" | "entity" | "month" | "quarter" | "year" | "total";
