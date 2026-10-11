"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, FileSpreadsheet, FileText, UploadCloud, X } from "lucide-react";
import { CREATE_VALUE, CreateAccountDialog } from "@/components/create-dialogs";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { formatCents } from "@/lib/money";
import {
  detectMapping,
  looksLikeChargesArePositive,
  looksLikeOfx,
  parseCsvText,
  parseOfx,
  rowsFromCsv,
  type ColumnMapping,
  type CsvTable,
  type DateFormat,
  type ParsedStatement,
} from "@/lib/import/statement";
import { initialMatch, nameProblems, toMappingPayload, unconfirmed, type MatchState } from "@/lib/import/matchState";
import { StessaMapping } from "./StessaMapping";
import { commitStatement, commitStessa, previewStessa, type ImportResult, type StatementResult, type StessaPreview } from "./actions";

export interface EntityOption {
  id: string;
  name: string;
}
export interface PortfolioOption {
  id: string;
  name: string;
}
export interface CashAccountOption {
  id: string;
  name: string;
  last4: string | null;
  isCard: boolean;
  scope: string;
}

type Tab = "stessa" | "statement";

export function ImportWizard({
  entities,
  portfolios,
  accounts,
}: {
  entities: EntityOption[];
  portfolios: PortfolioOption[];
  accounts: CashAccountOption[];
}) {
  const [tab, setTab] = useState<Tab>("stessa");
  const tabs: { key: Tab; label: string; hint: string }[] = [
    { key: "stessa", label: "Stessa ledger", hint: "Move over your history from Stessa" },
    { key: "statement", label: "Bank or card statement", hint: "CSV, OFX or QFX from your bank" },
  ];

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="What are you importing?" className="grid gap-2 sm:grid-cols-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-2xl border p-4 text-left transition ${
              tab === t.key ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-border bg-surface hover:border-border-strong"
            }`}
          >
            <span className="block font-semibold">{t.label}</span>
            <span className="block text-sm text-muted">{t.hint}</span>
          </button>
        ))}
      </div>

      {tab === "stessa" ? (
        <StessaImport entities={entities} portfolios={portfolios} />
      ) : (
        <StatementImport accounts={accounts} entities={entities} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Dropzone({
  accept,
  multiple,
  onFiles,
  hint,
  icon,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  hint: string;
  icon: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition focus-within:ring-4 focus-within:ring-brand-100 ${
        over ? "border-brand-500 bg-brand-50" : "border-border-strong bg-background hover:bg-brand-50/50"
      }`}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = ""; // allow choosing the same file again
        }}
      />
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-700">{icon}</span>
      <span className="font-medium">
        Drop {multiple ? "files" : "a file"} here, or <span className="text-brand-700 underline underline-offset-2">browse</span>
      </span>
      <span className="text-sm text-muted">{hint}</span>
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "muted" }) {
  const color = tone === "good" ? "text-brand-700" : tone === "warn" ? "text-warning-fg" : tone === "muted" ? "text-muted" : "";
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`num mt-1 text-2xl font-semibold ${color}`}>{value.toLocaleString("en-US")}</p>
    </div>
  );
}

const longDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ---------------------------------------------------------------------------
// Stessa
// ---------------------------------------------------------------------------

function StessaImport({ entities, portfolios }: { entities: EntityOption[]; portfolios: PortfolioOption[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [portfolioId] = useState(portfolios[0]?.id ?? "");
  const [preview, setPreview] = useState<StessaPreview | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const form = () => {
    const fd = new FormData();
    fd.set("entity_id", entityId);
    fd.set("portfolio_id", portfolioId);
    if (match) fd.set("mapping", JSON.stringify(toMappingPayload(match)));
    for (const f of files) fd.append("files", f);
    return fd;
  };

  const reset = () => {
    setFiles([]);
    setPreview(null);
    setMatch(null);
    setResult(null);
    setError(undefined);
  };

  if (entities.length === 0) {
    return (
      <Card className="p-8 text-center text-muted">
        Add an entity first, then come back to import. <Link href="/onboarding" className="font-medium text-brand-700 underline">Get started</Link>
      </Card>
    );
  }

  if (result) {
    return (
      <Card className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold">Import complete</p>
            <p className="text-sm text-muted">
              {result.imported.toLocaleString("en-US")} transactions imported
              {result.duplicates > 0 ? `, ${result.duplicates.toLocaleString("en-US")} skipped because they were already imported` : ""}.
              {result.createdPortfolios > 0 && ` Created ${result.createdPortfolios} new ${result.createdPortfolios === 1 ? "portfolio" : "portfolios"}.`}
              {result.createdProperties.length > 0 && ` Created ${result.createdProperties.length} new ${result.createdProperties.length === 1 ? "property" : "properties"}.`}
              {result.createdAccounts > 0 && ` Created ${result.createdAccounts} new ${result.createdAccounts === 1 ? "account" : "accounts"}.`}
              {result.createdCategories > 0 && ` Created ${result.createdCategories} new ${result.createdCategories === 1 ? "category" : "categories"}.`}
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Posted to your books" value={result.posted} tone="good" />
          <Stat label="Waiting for review" value={result.pending} tone={result.pending > 0 ? "warn" : "muted"} />
          <Stat label="Skipped as duplicates" value={result.duplicates} tone="muted" />
        </div>
        <div className="flex flex-wrap gap-2">
          {result.pending > 0 && (
            <Link href="/review" className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 font-medium text-white hover:bg-brand-700">
              Review {result.pending.toLocaleString("en-US")} transactions
            </Link>
          )}
          <Link href="/opening-balances" className="inline-flex h-11 items-center rounded-xl border border-border-strong bg-surface px-5 font-medium hover:bg-brand-50">
            Set opening balances
          </Link>
          <Link href="/reports" className="inline-flex h-11 items-center rounded-xl border border-border-strong bg-surface px-5 font-medium hover:bg-brand-50">
            View reports
          </Link>
          <Button variant="ghost" onClick={reset}>
            Import more
          </Button>
        </div>
      </Card>
    );
  }

  if (preview) {
    const t = preview.totals;
    const fresh = t.rows - t.duplicates;
    const todo = match ? unconfirmed(preview.setup, match) : { properties: [], sources: [] };
    const toConfirm = todo.properties.length + todo.sources.length;
    const problems = match ? nameProblems(match) : [];
    return (
      <Card className="space-y-5 p-6">
        <div>
          <h2 className="text-lg font-semibold">Here&apos;s what will happen</h2>
          <p className="text-sm text-muted">
            {t.rows.toLocaleString("en-US")} transactions found
            {preview.dateFrom && preview.dateTo ? `, from ${longDate(preview.dateFrom)} to ${longDate(preview.dateTo)}` : ""}. Nothing has been changed yet.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Ready to post" value={t.clean} tone="good" />
          <Stat label="Need a look" value={t.review} tone={t.review > 0 ? "warn" : "muted"} />
          <Stat label="Need a category" value={t.unresolved} tone={t.unresolved > 0 ? "warn" : "muted"} />
          <Stat label="Already imported" value={t.duplicates} tone="muted" />
        </div>

        {preview.assumptions.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium">We applied these rules, so they won&apos;t need review:</p>
            <ul className="space-y-1 text-sm text-muted">
              {preview.assumptions.map((a) => (
                <li key={a.text}>
                  <span className="num font-medium text-foreground">{a.count}</span> · {a.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview.reasons.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium">These will wait for you in Review:</p>
            <ul className="space-y-1 text-sm text-muted">
              {preview.reasons.slice(0, 6).map((r) => (
                <li key={r.reason}>
                  <span className="num font-medium text-foreground">{r.count}</span> · {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {match && (
          <StessaMapping
            setup={preview.setup}
            state={match}
            onChange={setMatch}
            portfolios={portfolios}
            defaultPortfolioId={portfolioId}
          />
        )}

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted">
                <th scope="col" className="px-4 py-2">Property</th>
                <th scope="col" className="px-4 py-2">File</th>
                <th scope="col" className="px-4 py-2 text-right">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {preview.files.map((f) => (
                <tr key={f.name + f.property} className="border-t border-border/70">
                  <td className="px-4 py-2 font-medium">
                    {f.propertyCount > 1 ? `${f.property} (${f.propertyCount} properties)` : f.property}
                    {f.isNew && (
                      <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                        {f.propertyCount > 1 ? `${f.newCount} new` : "New property"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted">{f.name}</td>
                  <td className="num px-4 py-2 text-right">{f.rows.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {preview.unreadable.length > 0 && (
          <Notice>
            {preview.unreadable.map((u) => (
              <span key={u.name} className="block">
                <strong>{u.name}:</strong> {u.error}
              </span>
            ))}
          </Notice>
        )}

        {toConfirm > 0 && (
          <Notice tone="info">
            {toConfirm} {toConfirm === 1 ? "match looks similar to" : "matches look similar to"} something you already have. Confirm {toConfirm === 1 ? "it" : "them"} above, or change the match, before importing.
          </Notice>
        )}
        {problems.map((m) => (
          <Notice key={m}>{m}</Notice>
        ))}
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || fresh === 0 || toConfirm > 0 || problems.length > 0}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const r = await commitStessa(form());
                if (r.error) setError(r.error);
                else if (r.result) setResult(r.result);
              })
            }
          >
            {pending ? "Importing…" : fresh === 0 ? "Nothing new to import" : `Import ${fresh.toLocaleString("en-US")} transactions`}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setPreview(null);
              setMatch(null);
            }}
            disabled={pending}
          >
            Back
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="text-lg font-semibold">Import Stessa general ledgers</h2>
        <p className="text-sm text-muted">
          In Stessa, open Reports and download the General Ledger for each property as Excel. Upload as many as you like at once.
        </p>
      </div>

      {entities.length > 1 && (
        <div className="max-w-sm">
          <Field label="These belong to">
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Dropzone
        accept=".xlsx"
        multiple
        icon={<UploadCloud className="h-6 w-6" aria-hidden />}
        hint="Excel files (.xlsx), up to 8 MB each"
        onFiles={(picked) => setFiles((prev) => [...prev, ...picked.filter((f) => /\.xlsx$/i.test(f.name) && !prev.some((p) => p.name === f.name && p.size === f.size))])}
      />

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.name + f.size} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="num text-muted">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-brand-50">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <Notice>{error}</Notice>}
      <Button
        disabled={pending || files.length === 0}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const r = await previewStessa(form());
            if (r.error) setError(r.error);
            else if (r.preview) {
              setPreview(r.preview);
              setMatch(initialMatch(r.preview.setup, portfolioId));
            }
          })
        }
      >
        {pending ? "Reading your files…" : "Preview import"}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bank or card statement
// ---------------------------------------------------------------------------

function StatementImport({ accounts, entities }: { accounts: CashAccountOption[]; entities: EntityOption[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [extraAccounts, setExtraAccounts] = useState<CashAccountOption[]>([]);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const allAccounts = [...accounts, ...extraAccounts.filter((e) => !accounts.some((a) => a.id === e.id))];
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [ofx, setOfx] = useState<ParsedStatement | null>(null);
  const [flipHint, setFlipHint] = useState(false);
  const [result, setResult] = useState<StatementResult | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const account = allAccounts.find((a) => a.id === accountId);

  const parsed: ParsedStatement | null = useMemo(() => {
    if (ofx) return ofx;
    if (table && mapping) return rowsFromCsv(table, mapping);
    return null;
  }, [ofx, table, mapping]);

  const summary = useMemo(() => {
    if (!parsed || parsed.rows.length === 0) return null;
    const dates = parsed.rows.map((r) => r.date).sort();
    return {
      moneyIn: parsed.rows.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0),
      moneyOut: parsed.rows.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0),
      from: dates[0],
      to: dates.at(-1)!,
    };
  }, [parsed]);

  const reset = () => {
    setFileName("");
    setTable(null);
    setMapping(null);
    setOfx(null);
    setFlipHint(false);
    setResult(null);
    setError(undefined);
  };

  async function load(files: File[]) {
    const file = files[0];
    if (!file) return;
    setError(undefined);
    setResult(null);
    const text = await file.text();
    setFileName(file.name);

    if (looksLikeOfx(text)) {
      const p = parseOfx(text);
      setOfx(p);
      setTable(null);
      setMapping(null);
      if (p.rows.length === 0) setError("No transactions were found in this file.");
      return;
    }
    const t = parseCsvText(text);
    if (t.headers.length === 0 || t.rows.length === 0) {
      setError("This file doesn't look like a bank statement. Try a CSV, OFX or QFX download from your bank.");
      return;
    }
    const m = detectMapping(t);
    // Credit card statements often list charges as positive numbers.
    const charges = looksLikeChargesArePositive(t, m);
    setFlipHint(charges);
    setOfx(null);
    setTable(t);
    setMapping({ ...m, flip: charges && Boolean(account?.isCard) });
  }

  const accountDialog = (
    <CreateAccountDialog
      open={creatingAccount}
      onClose={() => setCreatingAccount(false)}
      entities={entities}
      onCreated={(a) => {
        setExtraAccounts((prev) => [...prev, { id: a.id, name: a.name, last4: a.last4, isCard: !a.isBank, scope: "All properties" }]);
        setAccountId(a.id);
        setCreatingAccount(false);
      }}
    />
  );

  if (allAccounts.length === 0) {
    return (
      <Card className="space-y-4 p-8 text-center text-muted">
        <p>Add a bank account or credit card first, then import its statement.</p>
        <Button onClick={() => setCreatingAccount(true)}>Create a bank account or credit card</Button>
        {accountDialog}
      </Card>
    );
  }

  if (result) {
    return (
      <Card className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold">{result.imported === 0 ? "Nothing new to import" : "Import complete"}</p>
            <p className="text-sm text-muted">
              {result.imported === 0 ? (
                <>All {result.duplicates.toLocaleString("en-US")} transactions in this file were already imported into <strong>{result.accountName}</strong>.</>
              ) : (
                <>
                  {result.imported.toLocaleString("en-US")} transactions added to <strong>{result.accountName}</strong>
                  {result.duplicates > 0 ? `, ${result.duplicates.toLocaleString("en-US")} skipped because they were already imported` : ""}. They&apos;re waiting in Review for a category.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.imported > 0 && (
            <Link href="/review" className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 font-medium text-white hover:bg-brand-700">
              Review {result.imported.toLocaleString("en-US")} transactions
            </Link>
          )}
          <Button variant="ghost" onClick={reset}>
            Import another statement
          </Button>
        </div>
      </Card>
    );
  }

  const col = (i: number | null, key: keyof ColumnMapping, label: string, optional = false) =>
    table && mapping ? (
      <Field label={label}>
        <Select
          compact
          value={i === null ? "" : String(i)}
          onChange={(e) => setMapping({ ...mapping, [key]: e.target.value === "" ? null : Number(e.target.value) })}
        >
          {optional && <option value="">None</option>}
          {table.headers.map((h, idx) => (
            <option key={idx} value={idx}>
              {h || `Column ${idx + 1}`}
            </option>
          ))}
        </Select>
      </Field>
    ) : null;

  const preview = parsed?.rows.slice(0, 8) ?? [];

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="text-lg font-semibold">Import a bank or card statement</h2>
        <p className="text-sm text-muted">
          Download your transactions from your bank as CSV, OFX or QFX. They&apos;ll wait in Review so you can give each one a category.
        </p>
      </div>

      <div className="max-w-md">
        <label htmlFor="statement-account" className="mb-1.5 block text-sm font-medium">
          Which account is this for?
        </label>
        <Select
          id="statement-account"
          value={accountId}
          onChange={(e) => (e.target.value === CREATE_VALUE ? setCreatingAccount(true) : setAccountId(e.target.value))}
        >
          {allAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.last4 ? ` ••${a.last4}` : ""} {a.isCard ? "(credit card)" : ""}
            </option>
          ))}
          <option value={CREATE_VALUE}>＋ Create new bank account or credit card…</option>
        </Select>
        {account && <p className="mt-1.5 text-[13px] text-muted">Used for: {account.scope}</p>}
        {accountDialog}
      </div>

      {!parsed && (
        <Dropzone accept=".csv,.ofx,.qfx,.txt" icon={<FileText className="h-6 w-6" aria-hidden />} hint="CSV, OFX or QFX" onFiles={load} />
      )}

      {fileName && parsed && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{fileName}</span>
          <button type="button" onClick={reset} className="text-sm font-medium text-brand-700 hover:underline">
            Choose a different file
          </button>
        </div>
      )}

      {table && mapping && (
        <div className="space-y-4 rounded-2xl border border-border bg-background p-4">
          <p className="text-sm font-medium">Tell us which columns are which. We&apos;ve made our best guess.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {col(mapping.date, "date", "Date")}
            {col(mapping.description, "description", "Description")}
            <Field label="Amounts">
              <Select
                compact
                value={mapping.amount === null ? "split" : "single"}
                onChange={(e) =>
                  setMapping(
                    e.target.value === "single"
                      ? { ...mapping, amount: mapping.amount ?? mapping.debit ?? 0, debit: null, credit: null }
                      : { ...mapping, amount: null, debit: mapping.debit ?? 0, credit: mapping.credit ?? Math.min(1, table.headers.length - 1) },
                  )
                }
              >
                <option value="single">One amount column</option>
                <option value="split">Separate debit and credit columns</option>
              </Select>
            </Field>
            <Field label="Date format">
              <Select compact value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })}>
                <option value="auto">Detect automatically</option>
                <option value="mdy">Month / day / year</option>
                <option value="dmy">Day / month / year</option>
                <option value="ymd">Year-month-day</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {mapping.amount !== null ? (
              col(mapping.amount, "amount", "Amount")
            ) : (
              <>
                {col(mapping.debit, "debit", "Money out (debit)")}
                {col(mapping.credit, "credit", "Money in (credit)")}
              </>
            )}
          </div>
          {mapping.amount !== null && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]" checked={mapping.flip} onChange={(e) => setMapping({ ...mapping, flip: e.target.checked })} />
              <span>
                Reverse the sign of the amounts.
                <span className="block text-[13px] text-muted">
                  {flipHint
                    ? "Most of these amounts are positive, which usually means charges are listed as positive. Turn this on so charges count as money out."
                    : "Turn this on if money you spent shows as a positive number."}
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {parsed && parsed.rows.length > 0 && summary && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Transactions" value={parsed.rows.length} />
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Money in</p>
              <p className="num mt-1 text-xl font-semibold text-positive">{formatCents(summary.moneyIn)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Money out</p>
              <p className="num mt-1 text-xl font-semibold">{formatCents(summary.moneyOut)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Dates</p>
              <p className="mt-1 text-sm font-medium">
                {longDate(summary.from)} – {longDate(summary.to)}
              </p>
            </div>
          </div>
          {parsed.skipped > 0 && <p className="text-[13px] text-muted">{parsed.skipped} rows were skipped because they have no valid date or amount (such as totals).</p>}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-muted">
                  <th scope="col" className="px-4 py-2">Date</th>
                  <th scope="col" className="px-4 py-2">Description</th>
                  <th scope="col" className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-border/70">
                    <td className="num whitespace-nowrap px-4 py-1.5">{longDate(r.date)}</td>
                    <td className="px-4 py-1.5">{r.description}</td>
                    <td className={`num px-4 py-1.5 text-right ${r.amountCents > 0 ? "text-positive" : ""}`}>{formatCents(r.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > preview.length && (
              <p className="border-t border-border/70 px-4 py-2 text-[13px] text-muted">…and {(parsed.rows.length - preview.length).toLocaleString("en-US")} more</p>
            )}
          </div>
        </div>
      )}

      {parsed && parsed.rows.length === 0 && !error && <Notice>No transactions could be read with these column choices. Try different columns or date format.</Notice>}
      {error && <Notice>{error}</Notice>}

      {parsed && parsed.rows.length > 0 && (
        <Button
          disabled={pending || !accountId}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const r = await commitStatement({ accountId, filename: fileName, rows: parsed.rows });
              if (r.error) setError(r.error);
              else if (r.result) setResult(r.result);
            })
          }
        >
          {pending ? "Importing…" : `Import ${parsed.rows.length.toLocaleString("en-US")} transactions`}
        </Button>
      )}
    </Card>
  );
}
