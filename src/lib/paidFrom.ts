export interface CashAccount {
  id: string;
  code: string;
  isBank: boolean;
  subtype: string | null;
  propertyId: string | null;
  portfolioId: string | null;
}

/** Accounts money can be paid from or into: bank accounts and credit cards. */
export const isCashLike = (a: { isBank: boolean; subtype: string | null }) => a.isBank || a.subtype === "credit_card";

/**
 * The account a transaction on a property is paid from by default:
 *   1. an account tied to that property,
 *   2. else one tied to the property's portfolio,
 *   3. else the entity's general account (Operating Checking, or the first bank account).
 * Within a step a bank account beats a credit card. The user can always pick a different one.
 */
export function resolvePaidFrom(property: { id: string; portfolioId: string | null } | null, accounts: CashAccount[]): string | null {
  const cash = accounts.filter(isCashLike);
  const pick = (list: CashAccount[]) =>
    [...list].sort((a, b) => Number(b.isBank) - Number(a.isBank) || a.code.localeCompare(b.code, undefined, { numeric: true }))[0];

  if (property) {
    const own = cash.filter((a) => a.propertyId === property.id);
    if (own.length > 0) return pick(own).id;
    const shared = cash.filter((a) => !a.propertyId && a.portfolioId !== null && a.portfolioId === property.portfolioId);
    if (shared.length > 0) return pick(shared).id;
  }
  const general = cash.filter((a) => !a.propertyId && !a.portfolioId);
  return (general.find((a) => a.code === "1000") ?? pick(general))?.id ?? null;
}
