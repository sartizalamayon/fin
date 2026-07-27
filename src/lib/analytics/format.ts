import { formatMonthLabel } from "@/lib/core/dates";
import { formatMoney } from "@/lib/core/money";
import type { Category, Direction } from "@/lib/core/types";

/**
 * Display formatting for the dashboard.
 *
 * Every money string in the app ultimately comes out of `formatMoney` from
 * @/lib/core/money — including the abbreviated forms below, which derive their
 * currency prefix from it rather than hard-coding "৳". Scaling to k/M is done
 * with integer maths on the minor units so no IEEE754 tail ever reaches a label.
 */

const PREFIX_CACHE = new Map<string, string>();

/**
 * The currency prefix the locale formatter uses, e.g. `"BDT "` or `"$"`.
 * Taken from `formatMoney` so abbreviated labels never drift from full ones.
 */
function currencyPrefix(currency: string): string {
  let prefix = PREFIX_CACHE.get(currency);
  if (prefix === undefined) {
    // "BDT 0" -> "BDT ", "$0" -> "$"
    prefix = formatMoney(0, currency, { compact: true }).replace(/[\d]/g, "");
    PREFIX_CACHE.set(currency, prefix);
  }
  return prefix;
}

export interface CompactMoneyOptions {
  /** Drop the currency prefix — for axis ticks, where the header names the unit. */
  symbol?: boolean;
}

/**
 * Chart-grade money: `BDT 12.5k` instead of `BDT 12,500.00`.
 *
 * A 375px phone cannot spare 90px of y-axis for a fully punctuated figure, and
 * poisha are noise at chart scale. Values under 1,000 are shown in full (compact
 * mode already drops the decimals when they are zero), so small numbers stay
 * exact and only large ones are abbreviated.
 */
export function formatCompactMoney(
  minor: number,
  currency: string = "BDT",
  options: CompactMoneyOptions = {},
): string {
  const withSymbol = options.symbol !== false;
  const prefix = withSymbol ? currencyPrefix(currency) : "";
  const abs = Math.abs(minor);

  // Under 1,000 major units: no abbreviation needed.
  if (abs < 100_000) {
    const full = formatMoney(minor, currency, { compact: true });
    return withSymbol ? full : stripPrefix(full, currency);
  }

  // Tenths of the unit as an integer: 1_250_000 poisha / 10_000 = 125 -> "12.5k".
  const [divisor, suffix] =
    abs < 100_000_000 ? [10_000, "k"] : [10_000_000, "M"];
  const tenths = Math.round(minor / divisor);
  const magnitude = Math.abs(tenths);
  const whole = Math.trunc(magnitude / 10);
  const remainder = magnitude % 10;
  const digits = remainder === 0 ? `${whole}` : `${whole}.${remainder}`;

  const body = `${prefix}${digits}${suffix}`;
  return tenths < 0 ? `-${body}` : body;
}

function stripPrefix(formatted: string, currency: string): string {
  return formatted.replace(currencyPrefix(currency), "").trim();
}

/**
 * A signed amount for a transaction row: `+BDT 1,200.00` / `-BDT 450.50`.
 * The sign is what carries the direction; colour is only a reinforcement.
 */
export function formatDirectionalMoney(
  minor: number,
  direction: Direction,
  currency: string = "BDT",
): string {
  const sign = direction === "credit" ? "+" : "−"; // real minus, not hyphen
  return `${sign}${formatMoney(Math.abs(minor), currency)}`;
}

/** `+BDT 20,594.50` / `−BDT 3,200` — full precision with the sign in front. */
export function formatSignedMoney(
  minor: number,
  currency: string = "BDT",
): string {
  const body = formatMoney(Math.abs(minor), currency, { compact: true });
  if (minor === 0) return body;
  return `${minor > 0 ? "+" : "−"}${body}`;
}

/** `+BDT 12.5k` / `−BDT 3.2k` — for tight spots such as chart labels. */
export function formatSignedCompactMoney(
  minor: number,
  currency: string = "BDT",
): string {
  const body = formatCompactMoney(Math.abs(minor), currency);
  if (minor === 0) return body;
  return `${minor > 0 ? "+" : "−"}${body}`;
}

/**
 * Axis-width month label: `Jul`, or `Jan '26` at a year boundary so a
 * multi-year window never shows two identical ticks.
 */
export function shortMonthLabel(key: string): string {
  const full = formatMonthLabel(key); // "Jul 2026"
  const [month, year] = full.split(" ");
  if (!year) return full;
  return key.endsWith("-01") ? `${month} '${year.slice(2)}` : month;
}

/** `12 Jul` — a transaction-row date in Asia/Dhaka time. */
export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dhaka",
  });
}

/** `Sun, 12 Jul 2026` — the day heading in the full transaction list. */
export function formatDayHeading(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dhaka",
  });
}

/** `34%`. Shares below 1% round up to `<1%` so a row never reads as `0%`. */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  const percent = share * 100;
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

const CATEGORY_LABELS: Record<Category, string> = {
  food: "Food & drink",
  transport: "Transport",
  shopping: "Shopping",
  bills: "Bills & utilities",
  health: "Health",
  education: "Education",
  entertainment: "Entertainment",
  salary: "Salary",
  transfer: "Transfer",
  fees: "Fees & charges",
  cash: "Cash",
  other: "Other",
};

export function categoryLabel(category: Category | null): string {
  return category ? CATEGORY_LABELS[category] : CATEGORY_LABELS.other;
}
