import { monthKey } from "@/lib/core/dates";
import type { Category, Direction, Transaction } from "@/lib/core/types";

/**
 * Search, filter and paging for the transaction list. Pure: the page owns the
 * state, this module owns the meaning of that state.
 */

/** Asia/Dhaka is a fixed +06:00 with no DST — same convention as core/dates. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** `YYYY-MM-DD` day bucket in Dhaka time. */
export function dayKey(date: Date): string {
  return new Date(date.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export const DIRECTION_FILTERS = ["all", "credit", "debit"] as const;
export type DirectionFilter = (typeof DIRECTION_FILTERS)[number];

export interface TransactionQuery {
  /** Matches counterparty, description, reference id and provider. */
  search?: string;
  /** Empty or omitted means every category. */
  categories?: readonly Category[];
  direction?: DirectionFilter;
  /** Inclusive `YYYY-MM-DD` bounds, interpreted in Dhaka time. */
  from?: string;
  to?: string;
  /** Restrict to one `YYYY-MM` bucket. */
  month?: string;
  /**
   * Own-account transfers are part of the ledger and shown by default — they
   * are only excluded from *totals*, never from the list itself.
   */
  includeTransfers?: boolean;
}

export const EMPTY_QUERY: TransactionQuery = {};

function matchesSearch(txn: Transaction, needle: string): boolean {
  const haystack = [
    txn.counterparty,
    txn.description,
    txn.refId,
    txn.provider,
    txn.accountRef,
  ];
  return haystack.some((field) => field?.toLowerCase().includes(needle));
}

export function filterTransactions(
  txns: readonly Transaction[],
  query: TransactionQuery = EMPTY_QUERY,
): Transaction[] {
  const needle = query.search?.trim().toLowerCase() ?? "";
  const categories =
    query.categories && query.categories.length > 0
      ? new Set<Category>(query.categories)
      : null;
  const direction = query.direction ?? "all";
  const includeTransfers = query.includeTransfers ?? true;

  return txns.filter((txn) => {
    if (!includeTransfers && (txn.transferPairId !== null || txn.category === "transfer")) {
      return false;
    }
    if (direction !== "all" && txn.direction !== direction) return false;
    if (categories && !categories.has(txn.category ?? "other")) return false;
    if (query.month && monthKey(txn.occurredAt) !== query.month) return false;

    if (query.from || query.to) {
      const day = dayKey(txn.occurredAt);
      if (query.from && day < query.from) return false;
      if (query.to && day > query.to) return false;
    }

    if (needle && !matchesSearch(txn, needle)) return false;
    return true;
  });
}

/** Newest first — the order a ledger is read in. */
export function sortByDateDesc(txns: readonly Transaction[]): Transaction[] {
  return [...txns].sort(
    (a, b) =>
      b.occurredAt.getTime() - a.occurredAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

export interface Page<T> {
  items: T[];
  /** 1-based, clamped into range. */
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): Page<T> {
  const size = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const start = (current - 1) * size;

  return {
    items: items.slice(start, start + size),
    page: current,
    pageSize: size,
    pageCount,
    total: items.length,
    hasPrevious: current > 1,
    hasNext: current < pageCount,
  };
}

export interface DayGroup {
  /** `YYYY-MM-DD` in Dhaka time. */
  day: string;
  date: Date;
  txns: Transaction[];
}

/**
 * Group a (already sorted) list into day sections. Long ledgers are far easier
 * to scan on a phone with sticky day headings than as one undifferentiated run.
 */
export function groupByDay(txns: readonly Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;

  for (const txn of txns) {
    const day = dayKey(txn.occurredAt);
    if (!current || current.day !== day) {
      current = { day, date: txn.occurredAt, txns: [] };
      groups.push(current);
    }
    current.txns.push(txn);
  }

  return groups;
}
