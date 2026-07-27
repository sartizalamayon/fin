import { monthKey } from "@/lib/core/dates";
import type { Category, Direction, Transaction } from "@/lib/core/types";

/**
 * Pure aggregation over transactions. No I/O, no clock, no React — every
 * function here is a total function of its arguments so the charts can be
 * reasoned about (and tested) without a database.
 *
 * All arithmetic is in integer minor units (poisha). The only float in this
 * module is `share`, which is a display ratio, never money.
 */

// ---------------------------------------------------------------------------
// The transfer rule — the single most important invariant in this module
// ---------------------------------------------------------------------------

/**
 * OWN-ACCOUNT TRANSFERS ARE NOT INCOME AND NOT SPENDING.
 *
 * A bank -> bKash "Add Money" produces two rows: a debit on the bank side and a
 * credit on the wallet side. Both are the user moving their own money. Counting
 * them would inflate income AND expense by the same amount, which makes every
 * total, chart and category share lie — a ৳10,000 top-up would read as ৳10,000
 * "earned" and ৳10,000 "spent" that never happened.
 *
 * A row is an own-account transfer when either:
 *   1. `transferPairId` is non-null — the dedupe layer matched its opposite leg; or
 *   2. `category === "transfer"` — classified as a transfer even though the
 *      opposite leg was never uploaded (only the bank statement exists, say).
 *
 * Excluded rows still appear in the transaction list — the user did make that
 * move and needs to see it. They simply contribute nothing to income/expense
 * totals, category breakdowns or counterparty rankings.
 */
export function isOwnTransfer(txn: Transaction): boolean {
  return txn.transferPairId !== null || txn.category === "transfer";
}

/** Rows that count towards income/expense. See {@link isOwnTransfer}. */
export function spendableTransactions(
  txns: readonly Transaction[],
): Transaction[] {
  return txns.filter((txn) => !isOwnTransfer(txn));
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface MonthlyTotal {
  /** `YYYY-MM` bucket key in Asia/Dhaka time. */
  month: string;
  incomeMinor: number;
  expenseMinor: number;
  /** income − expense. Negative means the month spent more than it earned. */
  netMinor: number;
}

export interface CategoryTotal {
  category: Category;
  totalMinor: number;
  count: number;
  /** Fraction of the returned total, 0–1. Display-only; never money. */
  share: number;
}

export interface CounterpartyTotal {
  counterparty: string;
  totalMinor: number;
  count: number;
}

export interface SummaryStats {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  /** Non-transfer transactions in the window, both directions. */
  txnCount: number;
  /** Average size of an outgoing transaction, rounded to whole minor units. */
  avgTxnMinor: number;
}

export interface CategoryTotalsOptions {
  /** Restrict to one `YYYY-MM` bucket. Omit for all-time. */
  month?: string;
  /** Which side to break down. Defaults to `debit` — i.e. where money went. */
  direction?: Direction;
  /** Keep only the biggest N and fold the tail into `other`. */
  limit?: number;
}

export interface SummaryStatsOptions {
  /** `YYYY-MM` bucket to summarise. Omit for all-time. */
  month?: string;
}

// ---------------------------------------------------------------------------
// Month keys
// ---------------------------------------------------------------------------

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` -> absolute month ordinal, so ranges are plain integer maths. */
function monthOrdinal(key: string): number | null {
  const match = MONTH_KEY.exec(key);
  if (!match) return null;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

function ordinalToMonthKey(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Every month from `start` to `end` inclusive, with no holes.
 * Returns `[]` when either key is malformed or the range runs backwards.
 */
export function enumerateMonths(start: string, end: string): string[] {
  const from = monthOrdinal(start);
  const to = monthOrdinal(end);
  if (from === null || to === null || to < from) return [];

  const out: string[] = [];
  for (let i = from; i <= to; i += 1) out.push(ordinalToMonthKey(i));
  return out;
}

/** Shift a month key by N months. `addMonths("2026-01", -1) === "2025-12"`. */
export function addMonths(key: string, delta: number): string {
  const ordinal = monthOrdinal(key);
  if (ordinal === null) return key;
  return ordinalToMonthKey(ordinal + delta);
}

/**
 * Distinct `YYYY-MM` buckets with activity, newest first.
 *
 * Transfers are *included* here: a month whose only rows were own-account moves
 * still has something to show in the transaction list, so the month picker must
 * offer it.
 */
export function availableMonths(txns: readonly Transaction[]): string[] {
  const seen = new Set<string>();
  for (const txn of txns) seen.add(monthKey(txn.occurredAt));
  return [...seen].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * Income vs expense per month, oldest first.
 *
 * Gap months between the first and last transaction are emitted with zeros so
 * the x-axis has no holes — a chart that silently skips April makes March look
 * adjacent to May and misreads as a continuous trend.
 *
 * Fees (`feeMinor`) are deliberately NOT added on top of expense: BD providers
 * usually post the charge as its own debit row (category `fees`), and adding the
 * embedded value as well would double-count it.
 */
export function monthlyTotals(txns: readonly Transaction[]): MonthlyTotal[] {
  const counted = spendableTransactions(txns);
  if (counted.length === 0) return [];

  const buckets = new Map<string, MonthlyTotal>();
  for (const txn of counted) {
    const month = monthKey(txn.occurredAt);
    let bucket = buckets.get(month);
    if (!bucket) {
      bucket = { month, incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
      buckets.set(month, bucket);
    }
    if (txn.direction === "credit") bucket.incomeMinor += txn.amountMinor;
    else bucket.expenseMinor += txn.amountMinor;
  }

  const keys = [...buckets.keys()].sort();
  const months = enumerateMonths(keys[0], keys[keys.length - 1]);

  return months.map(
    (month) =>
      buckets.get(month) ?? {
        month,
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: 0,
      },
  ).map((bucket) => ({
    ...bucket,
    netMinor: bucket.incomeMinor - bucket.expenseMinor,
  }));
}

/**
 * The trailing `count` months ending at `endMonth`, zero-filled.
 *
 * Charts want a fixed-width window: without this, a user with two months of
 * history gets two fat bars and a user with three years gets an unreadable comb.
 */
export function trailingMonths(
  rows: readonly MonthlyTotal[],
  count: number,
  endMonth?: string,
): MonthlyTotal[] {
  if (count <= 0) return [];

  const end = endMonth ?? rows[rows.length - 1]?.month;
  if (!end || monthOrdinal(end) === null) return [];

  const start = addMonths(end, -(count - 1));
  const byMonth = new Map(rows.map((row) => [row.month, row]));

  return enumerateMonths(start, end).map(
    (month) =>
      byMonth.get(month) ?? {
        month,
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: 0,
      },
  );
}

/**
 * Spend (or income) grouped by category, biggest first.
 *
 * Uncategorised rows land in `other` rather than being dropped — a breakdown
 * whose slices do not sum to the headline total is worse than a vague slice.
 */
export function categoryTotals(
  txns: readonly Transaction[],
  opts: CategoryTotalsOptions = {},
): CategoryTotal[] {
  const { month, direction = "debit", limit } = opts;

  const counted = spendableTransactions(txns).filter(
    (txn) =>
      txn.direction === direction &&
      (month === undefined || monthKey(txn.occurredAt) === month),
  );

  const buckets = new Map<Category, { totalMinor: number; count: number }>();
  for (const txn of counted) {
    const category: Category = txn.category ?? "other";
    const bucket = buckets.get(category) ?? { totalMinor: 0, count: 0 };
    bucket.totalMinor += txn.amountMinor;
    bucket.count += 1;
    buckets.set(category, bucket);
  }

  const grandTotalMinor = [...buckets.values()].reduce(
    (sum, bucket) => sum + bucket.totalMinor,
    0,
  );
  if (grandTotalMinor === 0) return [];

  const ranked = [...buckets.entries()]
    .map(([category, bucket]) => ({
      category,
      totalMinor: bucket.totalMinor,
      count: bucket.count,
      share: bucket.totalMinor / grandTotalMinor,
    }))
    .sort(
      (a, b) =>
        b.totalMinor - a.totalMinor || a.category.localeCompare(b.category),
    );

  if (limit === undefined || ranked.length <= limit) return ranked;

  // Fold the tail into `other` rather than inventing more colours for slices
  // too small to read on a phone.
  const head = ranked.slice(0, limit);
  const tail = ranked.slice(limit);
  const tailTotalMinor = tail.reduce((sum, row) => sum + row.totalMinor, 0);
  const tailCount = tail.reduce((sum, row) => sum + row.count, 0);

  const existingOther = head.find((row) => row.category === "other");
  if (existingOther) {
    existingOther.totalMinor += tailTotalMinor;
    existingOther.count += tailCount;
    existingOther.share = existingOther.totalMinor / grandTotalMinor;
    return head.sort((a, b) => b.totalMinor - a.totalMinor);
  }

  return [
    ...head,
    {
      category: "other" as Category,
      totalMinor: tailTotalMinor,
      count: tailCount,
      share: tailTotalMinor / grandTotalMinor,
    },
  ];
}

/**
 * Who the money goes to, biggest first. Own-account transfers are excluded —
 * "my own bKash wallet" is not a merchant.
 */
export function topCounterparties(
  txns: readonly Transaction[],
  limit = 5,
  opts: { month?: string; direction?: Direction } = {},
): CounterpartyTotal[] {
  if (limit <= 0) return [];
  const { month, direction = "debit" } = opts;

  const buckets = new Map<string, CounterpartyTotal>();
  for (const txn of spendableTransactions(txns)) {
    if (txn.direction !== direction) continue;
    if (month !== undefined && monthKey(txn.occurredAt) !== month) continue;

    const name = txn.counterparty?.trim() || "Unknown";
    const bucket = buckets.get(name) ?? {
      counterparty: name,
      totalMinor: 0,
      count: 0,
    };
    bucket.totalMinor += txn.amountMinor;
    bucket.count += 1;
    buckets.set(name, bucket);
  }

  return [...buckets.values()]
    .sort(
      (a, b) =>
        b.totalMinor - a.totalMinor ||
        a.counterparty.localeCompare(b.counterparty),
    )
    .slice(0, limit);
}

/** Headline numbers for the summary tiles. Transfers excluded throughout. */
export function summaryStats(
  txns: readonly Transaction[],
  opts: SummaryStatsOptions = {},
): SummaryStats {
  const { month } = opts;
  const counted = spendableTransactions(txns).filter(
    (txn) => month === undefined || monthKey(txn.occurredAt) === month,
  );

  let incomeMinor = 0;
  let expenseMinor = 0;
  let debitCount = 0;

  for (const txn of counted) {
    if (txn.direction === "credit") {
      incomeMinor += txn.amountMinor;
    } else {
      expenseMinor += txn.amountMinor;
      debitCount += 1;
    }
  }

  return {
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    txnCount: counted.length,
    // Integer division on minor units — a fractional poisha is not a thing.
    avgTxnMinor: debitCount === 0 ? 0 : Math.round(expenseMinor / debitCount),
  };
}
