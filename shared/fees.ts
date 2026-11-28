/**
 * Fee collection's rules on the PC, kept free of Electron so they test
 * plainly. Money is the web's: whole numbers of minor units (paisa) of the
 * school's currency, formatted only at the edge (src/lib/money.ts and
 * src/data/fees.ts in the ilmways repo). The server applies its own rules
 * again when the payment arrives.
 */

const MINOR_UNITS: Record<string, number> = {
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3,
  JPY: 0, KRW: 0, VND: 0,
};

export const minorDigits = (currency: string) => MINOR_UNITS[currency.toUpperCase()] ?? 2;
const perMajor = (currency: string) => 10 ** minorDigits(currency);

/** "1,250.50" or "1250" → minor units; null when it isn't an amount above zero. */
export function toMinor(input: string, currency: string): number | null {
  const clean = input.replace(/[,\s]/g, "");
  const digits = minorDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  const minor = Number(whole) * perMajor(currency) + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** As the web writes money: "Rs 1,250.00". */
export function formatMoney(minor: number, currency: string, locale = "en-PK"): string {
  const digits = minorDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / perMajor(currency));
  } catch {
    return `${currency} ${(minor / perMajor(currency)).toFixed(digits)}`;
  }
}

/** The web's receipt number: five digits, after the prefix if there is one. */
export function formatReceiptNo(prefix: string, n: number): string {
  const padded = String(n).padStart(5, "0");
  return prefix ? `${prefix}-${padded}` : padded;
}

export type OpenCharge = { id: string; outstanding: number; dueDate: string };

/**
 * Oldest due first, as the server allocates (src/data/fees.ts,
 * allocatePayment). What the PC prints on an offline receipt; the server
 * works it out again against the charges as they are when it arrives.
 */
export function allocateOldestFirst(amount: number, charges: OpenCharge[]): { allocations: { chargeId: string; amount: number }[]; advance: number } {
  let left = amount;
  const allocations: { chargeId: string; amount: number }[] = [];
  for (const charge of [...charges].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))) {
    if (left <= 0) break;
    if (charge.outstanding <= 0) continue;
    const take = Math.min(left, charge.outstanding);
    allocations.push({ chargeId: charge.id, amount: take });
    left -= take;
  }
  return { allocations, advance: left };
}

/** Receipt numbers per block, and when to ask for more (docs/DESKTOP-PLAN.md §3.6). */
export const RECEIPT_TOP_UP = 10;
