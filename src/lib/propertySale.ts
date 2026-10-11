/** The books' side of selling a property, and the journal entry that records it. */

export interface SaleFacts {
  /** Cost of the property and improvements, per account, in cents (what is on the balance sheet). */
  cost: { accountId: string; cents: number }[];
  accumDeprCents: number;
  accumDeprAccountId: string | null;
  loanCents: number;
  escrowCents: number;
  depositsCents: number;
  /** Net sale money already recorded as a Sale Proceeds deposit (credit balance). */
  recordedProceedsCents: number;
}

export interface SaleInputs {
  priceCents: number;
  /** Agent commissions, closing costs and anything else the seller paid out of the sale. */
  costsCents: number;
  /** Loan principal paid off at closing. */
  payoffCents: number;
  /** Security deposits handed to the buyer. */
  depositsCents: number;
  /** Escrow balance refunded to the seller. */
  escrowCents: number;
}

/** Accounts the entry posts to. */
export interface SaleAccounts {
  /** Where the net proceeds go: a bank account, or Transfers > Sale Proceeds when the deposit is already recorded. */
  proceeds: string;
  loan: string | null;
  deposits: string | null;
  escrow: string | null;
  accumDepr: string | null;
  gain: string;
}

export interface SaleLine {
  accountId: string;
  label: string;
  debitCents: number;
  creditCents: number;
}

export interface SaleResult {
  /** Cash the seller walks away with: price less costs, loan payoff and deposits handed over, plus escrow refunded. */
  netProceedsCents: number;
  costBasisCents: number;
  accumDeprCents: number;
  /** Price less selling costs, less cost basis net of depreciation. A loss is negative. */
  gainCents: number;
  lines: SaleLine[];
  problems: string[];
  warnings: string[];
}

const dr = (accountId: string, label: string, cents: number): SaleLine => ({ accountId, label, debitCents: cents, creditCents: 0 });
const cr = (accountId: string, label: string, cents: number): SaleLine => ({ accountId, label, debitCents: 0, creditCents: cents });

/**
 * One balanced entry:
 *   Dr net proceeds (cash)         Dr loan paid off        Dr deposits handed to the buyer
 *   Dr accumulated depreciation    Cr property cost        Cr escrow refunded
 *   Cr gain on sale (or Dr for a loss)
 * The gain is what is needed to balance it, which equals price - costs - (cost - depreciation).
 */
export function computeSale(facts: SaleFacts, input: SaleInputs, acct: SaleAccounts): SaleResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const { priceCents, costsCents, payoffCents, depositsCents, escrowCents } = input;

  if (!(priceCents > 0)) problems.push("Enter the sale price.");
  for (const [n, v] of [["selling costs", costsCents], ["loan payoff", payoffCents], ["deposits", depositsCents], ["escrow refund", escrowCents]] as const) {
    if (v < 0) problems.push(`The ${n} cannot be negative.`);
  }

  const costBasis = facts.cost.reduce((s, c) => s + c.cents, 0);
  const net = priceCents - costsCents - payoffCents - depositsCents + escrowCents;
  const accum = Math.max(facts.accumDeprCents, 0);
  // The gain is the balancing figure: amount realized less the property's book value.
  const gain = priceCents - costsCents + accum - costBasis;

  if (costBasis <= 0) warnings.push("No cost is recorded for this property, so the whole sale price would show as gain. Enter its cost on the Opening balances page first.");
  if (payoffCents > 0 && payoffCents > facts.loanCents + 1) warnings.push("The loan payoff is more than the loan balance in your books.");
  if (acct.proceeds === "") problems.push("Choose where the net proceeds went.");
  if (payoffCents > 0 && !acct.loan) problems.push("There is no loan account to apply the payoff to.");
  if (depositsCents > 0 && !acct.deposits) problems.push("There is no security deposits account.");
  if (escrowCents > 0 && !acct.escrow) problems.push("There is no escrow account.");

  const lines: SaleLine[] = [];
  if (net >= 0) lines.push(dr(acct.proceeds, "Net proceeds", net));
  else lines.push(cr(acct.proceeds, "Cash you paid in at closing", -net));
  if (payoffCents > 0 && acct.loan) lines.push(dr(acct.loan, "Loan paid off", payoffCents));
  if (depositsCents > 0 && acct.deposits) lines.push(dr(acct.deposits, "Security deposits handed to the buyer", depositsCents));
  if (accum > 0 && acct.accumDepr) lines.push(dr(acct.accumDepr, "Depreciation taken, removed", accum));
  for (const c of facts.cost) if (c.cents > 0) lines.push(cr(c.accountId, "Property cost, removed", c.cents));
  for (const c of facts.cost) if (c.cents < 0) lines.push(dr(c.accountId, "Property cost, removed", -c.cents));
  if (escrowCents > 0 && acct.escrow) lines.push(cr(acct.escrow, "Escrow refunded", escrowCents));
  if (gain > 0) lines.push(cr(acct.gain, "Gain on sale", gain));
  else if (gain < 0) lines.push(dr(acct.gain, "Loss on sale", -gain));

  const debits = lines.reduce((s, l) => s + l.debitCents, 0);
  const credits = lines.reduce((s, l) => s + l.creditCents, 0);
  if (debits !== credits && problems.length === 0) problems.push("The sale does not balance. Check the amounts.");

  return { netProceedsCents: net, costBasisCents: costBasis, accumDeprCents: accum, gainCents: gain, lines, problems, warnings };
}

/** Turn the facts query's rows into SaleFacts. */
export function factsFromRows(rows: { kind: string; account_id: string; cents: number | string }[]): SaleFacts {
  const sum = (k: string) => rows.filter((r) => r.kind === k).reduce((s, r) => s + Number(r.cents), 0);
  const accum = rows.find((r) => r.kind === "accum_depr");
  return {
    cost: rows.filter((r) => r.kind === "cost").map((r) => ({ accountId: r.account_id, cents: Number(r.cents) })),
    accumDeprCents: sum("accum_depr"),
    accumDeprAccountId: accum?.account_id ?? null,
    loanCents: sum("loan"),
    escrowCents: sum("escrow"),
    depositsCents: sum("deposits"),
    recordedProceedsCents: sum("proceeds"),
  };
}
