import { isCashLike } from "@/lib/paidFrom";
import { selectProperties } from "@/lib/reports/load";
import { classifyEntry, type TransactionKind } from "@/lib/reports/transactionType";
import { getSession } from "@/lib/workspace";

export const PAGE_SIZE = 50;

export interface TransactionParams {
  from: string;
  to: string;
  entity: string;
  property: string;
  account: string;
  q: string;
  showReversed: boolean;
  page: number;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Read the filters from the URL. Without dates, the list covers the latest year that has entries. */
export function parseTransactionParams(sp: Record<string, string | string[] | undefined>, latestYear: number): TransactionParams {
  const from = one(sp.from);
  const to = one(sp.to);
  return {
    from: isDate(from) ? from : `${latestYear}-01-01`,
    to: isDate(to) ? to : `${latestYear}-12-31`,
    entity: one(sp.entity) || "all",
    property: one(sp.property) || "all",
    account: one(sp.account) || "all",
    q: one(sp.q).trim().slice(0, 100),
    showReversed: one(sp.reversed) === "1",
    page: Math.max(1, Number.parseInt(one(sp.page), 10) || 1),
  };
}

export function transactionQuery(p: TransactionParams, patch: Partial<TransactionParams> = {}): string {
  const m = { ...p, ...patch };
  const q = new URLSearchParams({ from: m.from, to: m.to });
  if (m.entity !== "all") q.set("entity", m.entity);
  if (m.property !== "all") q.set("property", m.property);
  if (m.account !== "all") q.set("account", m.account);
  if (m.q) q.set("q", m.q);
  if (m.showReversed) q.set("reversed", "1");
  if (m.page > 1) q.set("page", String(m.page));
  return q.toString();
}

export interface TransactionLine {
  code: string;
  account: string;
  property: string;
  debitCents: number;
  creditCents: number;
}

export interface TransactionRow {
  id: string;
  date: string;
  description: string;
  type: TransactionKind;
  business: string;
  amountCents: number;
  /** "Mortgage Interest ← Operating Checking": what was debited and what was credited. */
  summary: string;
  propertyNames: string[];
  lines: TransactionLine[];
  isReversed: boolean;
  isReversal: boolean;
  /** Entered by hand or posted from an import (not a system opening balance). */
  canReverse: boolean;
}

export interface TransactionList {
  rows: TransactionRow[];
  total: number;
  pageCount: number;
  accountOptions: { code: string; name: string }[];
  entities: { id: string; name: string }[];
  properties: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  years: number[];
  showBusiness: boolean;
}

type EntryResult = {
  id: string;
  entity_id: string;
  entry_date: string;
  memo: string | null;
  source: string;
  reverses_entry_id: string | null;
  is_reversed: boolean;
  amount_cents: number | string;
  total_count: number | string;
};

export async function loadTransactions(p: TransactionParams): Promise<TransactionList> {
  const { supabase } = await getSession();

  const [{ data: ents }, props, { data: portfolios }, { data: first }, { data: last }] = await Promise.all([
    supabase.from("entities").select("id, name").order("name"),
    selectProperties(p.property),
    supabase.from("portfolios").select("id, name").order("name"),
    supabase.from("journal_entries").select("entry_date").order("entry_date").limit(1),
    supabase.from("journal_entries").select("entry_date").order("entry_date", { ascending: false }).limit(1),
  ]);
  const entities = (ents ?? []) as { id: string; name: string }[];
  const latest = last?.[0]?.entry_date ? Number(last[0].entry_date.slice(0, 4)) : new Date().getFullYear();
  const oldest = first?.[0]?.entry_date ? Number(first[0].entry_date.slice(0, 4)) : latest;
  const years = Array.from({ length: Math.max(1, latest - oldest + 1) }, (_, i) => latest - i);

  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const propertyName = new Map(props.all.map((x) => [x.id, x.name]));

  const entityIds = p.entity !== "all" && entityName.has(p.entity) ? [p.entity] : null;
  const { data, error } = await supabase.rpc("list_transactions", {
    p_from: p.from,
    p_to: p.to,
    p_entity_ids: entityIds,
    p_property_ids: props.filtered ? props.selected.map((x) => x.id) : null,
    p_account_code: p.account === "all" ? null : p.account,
    p_search: p.q || null,
    p_show_reversed: p.showReversed,
    p_limit: PAGE_SIZE,
    p_offset: (p.page - 1) * PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const entries = (data ?? []) as EntryResult[];
  const total = entries.length > 0 ? Number(entries[0].total_count) : 0;

  const { data: accountRows } = await supabase.from("accounts").select("id, parent_id, entity_id, code, name, type, subtype, is_bank");
  const accounts = new Map((accountRows ?? []).map((a) => [a.id as string, a]));
  const accountOptions = [...new Map((accountRows ?? []).map((a) => [a.code as string, { code: a.code as string, name: a.name as string }])).values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  );

  const lineRows = entries.length
    ? ((
        await supabase
          .from("journal_lines")
          .select("entry_id, account_id, property_id, debit_cents, credit_cents")
          .in(
            "entry_id",
            entries.map((e) => e.id),
          )
      ).data ?? [])
    : [];
  const linesByEntry = new Map<string, typeof lineRows>();
  for (const l of lineRows) linesByEntry.set(l.entry_id, [...(linesByEntry.get(l.entry_id) ?? []), l]);

  const label = (id: string) => {
    const a = accounts.get(id);
    const parent = a?.parent_id ? accounts.get(a.parent_id) : undefined;
    return a ? `${parent ? `${parent.name} › ` : ""}${a.name}` : "(unknown account)";
  };

  const rows: TransactionRow[] = entries.map((e) => {
    const raw = linesByEntry.get(e.id) ?? [];
    const lines: TransactionLine[] = raw
      .map((l) => ({
        code: (accounts.get(l.account_id)?.code as string | undefined) ?? "",
        account: label(l.account_id),
        property: l.property_id ? (propertyName.get(l.property_id) ?? "") : "",
        debitCents: Number(l.debit_cents),
        creditCents: Number(l.credit_cents),
      }))
      .sort((a, b) => Number(b.debitCents > 0) - Number(a.debitCents > 0));
    const kinds = raw.flatMap((l) => {
      const a = accounts.get(l.account_id);
      return a
        ? [
            {
              type: a.type as "asset" | "liability" | "equity" | "income" | "expense",
              cashLike: isCashLike({ isBank: a.is_bank as boolean, subtype: a.subtype as string | null }),
              loan: a.subtype === "loan",
              debit: Number(l.debit_cents) > 0,
            },
          ]
        : [];
    });
    const debits = lines.filter((l) => l.debitCents > 0).map((l) => l.account);
    const credits = lines.filter((l) => l.creditCents > 0).map((l) => l.account);
    const short = (xs: string[]) => (xs.length > 1 ? `${xs[0]} +${xs.length - 1} more` : (xs[0] ?? ""));
    return {
      id: e.id,
      date: e.entry_date,
      description: e.memo ?? "",
      type: classifyEntry(e.source, e.memo, kinds),
      business: entityName.get(e.entity_id) ?? "",
      amountCents: Number(e.amount_cents),
      summary: `${short(debits.map((x) => x.split(" › ").pop() ?? x))} ← ${short(credits.map((x) => x.split(" › ").pop() ?? x))}`,
      propertyNames: [...new Set(lines.map((l) => l.property).filter(Boolean))],
      lines,
      isReversed: e.is_reversed,
      isReversal: e.reverses_entry_id !== null,
      canReverse: !e.is_reversed && e.reverses_entry_id === null && e.source !== "system",
    };
  });

  return {
    rows,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    accountOptions,
    entities,
    properties: props.all.map((x) => ({ id: x.id, name: x.name })),
    portfolios: portfolios ?? [],
    years,
    showBusiness: entities.length > 1,
  };
}
