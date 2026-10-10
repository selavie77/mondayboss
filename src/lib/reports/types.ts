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
  /** One value per column (plus a trailing total when enabled). Cents, or a plain ratio for kind "ratio". */
  values?: (number | null)[];
}

export interface ReportData {
  title: string;
  subtitle: string;
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

export type ReportKind = "income-statement" | "net-cash-flow" | "capital-expenses";
export type ColumnGrouping = "property" | "month" | "quarter" | "year" | "total";
