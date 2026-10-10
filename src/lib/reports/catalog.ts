export interface ReportCategory {
  key: string;
  label: string;
}

export interface CatalogItem {
  key: string;
  name: string;
  description: string;
  category: string;
  /** False for reports on the roadmap that cannot be opened yet. */
  available: boolean;
}

export const CATEGORIES: ReportCategory[] = [
  { key: "business-overview", label: "Business Overview" },
  { key: "capital", label: "Capital & Depreciation" },
  { key: "tax", label: "Tax" },
  { key: "accounting", label: "Accounting" },
];

export const CATALOG: CatalogItem[] = [
  {
    key: "income-statement",
    name: "Income Statement",
    description: "Income and operating expenses by category, down to net operating income and net income.",
    category: "business-overview",
    available: true,
  },
  {
    key: "net-cash-flow",
    name: "Net Cash Flow",
    description: "Income and expenses by category, including debt service, capital expenses and transfers.",
    category: "business-overview",
    available: true,
  },
  {
    key: "capital-expenses",
    name: "Capital Expenses",
    description: "Schedule of acquisitions and improvements, with when each was placed in service and its useful life.",
    category: "capital",
    available: true,
  },
  {
    key: "schedule-e",
    name: "Schedule E Summary",
    description: "Rental income and expenses grouped by the lines on IRS Schedule E, per property and entity.",
    category: "tax",
    available: false,
  },
  {
    key: "balance-sheet",
    name: "Balance Sheet",
    description: "What you own and what you owe at a point in time, from your double-entry books.",
    category: "accounting",
    available: true,
  },
  {
    key: "trial-balance",
    name: "Trial Balance",
    description: "Every account's debit and credit balance, proving that your books balance.",
    category: "accounting",
    available: true,
  },
  {
    key: "general-ledger",
    name: "General Ledger",
    description: "Every journal entry line by account, with running balances.",
    category: "accounting",
    available: true,
  },
];

export const findReport = (key: string) => CATALOG.find((r) => r.key === key && r.available);
