import { describe, it, expect } from "vitest";

import {
  isOwnTransfer,
  spendableTransactions,
  monthlyTotals,
  categoryTotals,
  summaryStats,
  availableMonths,
  enumerateMonths,
  addMonths,
  trailingMonths,
} from "./aggregate";
import type { Transaction } from "@/lib/core/types";

/**
 * The rule these tests exist to protect: moving your own money between your
 * own accounts is not income and not spending.
 *
 * A bank → bKash "Add Money" produces a debit on one side and a credit on the
 * other. Counting both inflates income AND expense simultaneously, so the
 * dashboard reports a bigger salary and a bigger spend than the user has — and
 * the two errors hide each other, because the net still looks right.
 */

let seq = 0;

function txn(over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: "11111111-1111-4111-8111-111111111111",
    documentId: null,
    occurredAt: new Date("2026-03-15T06:00:00Z"),
    amountMinor: 10_000,
    direction: "debit",
    currency: "BDT",
    refId: null,
    counterparty: "Shop",
    description: "Purchase",
    provider: "bkash",
    accountRef: null,
    feeMinor: 0,
    balanceAfterMinor: null,
    category: null,
    rawText: "row",
    transferPairId: null,
    createdAt: new Date("2026-03-16T00:00:00Z"),
    ...over,
  };
}

describe("isOwnTransfer", () => {
  it("recognises a paired transfer leg", () => {
    expect(
      isOwnTransfer(txn({ transferPairId: "22222222-2222-4222-8222-222222222222" })),
    ).toBe(true);
  });

  it("recognises a row categorised as a transfer", () => {
    expect(isOwnTransfer(txn({ category: "transfer" }))).toBe(true);
  });

  it("leaves ordinary spending alone", () => {
    expect(isOwnTransfer(txn())).toBe(false);
    expect(isOwnTransfer(txn({ category: "food" }))).toBe(false);
  });
});

describe("transfer exclusion", () => {
  const pairId = "22222222-2222-4222-8222-222222222222";

  const ledger = [
    txn({ direction: "credit", amountMinor: 5_000_000, category: "salary" }),
    txn({ direction: "debit", amountMinor: 120_000, category: "food" }),
    // The two legs of one bank → bKash movement.
    txn({ direction: "debit", amountMinor: 1_000_000, transferPairId: pairId }),
    txn({ direction: "credit", amountMinor: 1_000_000, transferPairId: pairId }),
  ];

  it("drops both legs from the spendable set", () => {
    const spendable = spendableTransactions(ledger);
    expect(spendable).toHaveLength(2);
    expect(spendable.every((t) => t.transferPairId === null)).toBe(true);
  });

  it("keeps transfers out of income and expense totals", () => {
    const stats = summaryStats(ledger, { month: "2026-03" });

    // Without the rule these would be 6,000,000 and 1,120,000.
    expect(stats.incomeMinor).toBe(5_000_000);
    expect(stats.expenseMinor).toBe(120_000);
    expect(stats.netMinor).toBe(5_000_000 - 120_000);
  });

  it("keeps transfers out of the monthly chart", () => {
    const [march] = monthlyTotals(ledger).filter((m) => m.month === "2026-03");

    expect(march.incomeMinor).toBe(5_000_000);
    expect(march.expenseMinor).toBe(120_000);
  });

  it("keeps transfers out of the category breakdown", () => {
    const categories = categoryTotals(ledger, { month: "2026-03" });
    expect(categories.some((c) => c.category === "transfer")).toBe(false);
  });

  it("excludes a transfer flagged only by category", () => {
    const stats = summaryStats(
      [
        txn({ direction: "debit", amountMinor: 300_000, category: "transfer" }),
        txn({ direction: "debit", amountMinor: 50_000, category: "food" }),
      ],
      { month: "2026-03" },
    );

    expect(stats.expenseMinor).toBe(50_000);
  });
});

describe("monthlyTotals", () => {
  it("fills gap months with zeros so the axis has no holes", () => {
    const totals = monthlyTotals([
      txn({ occurredAt: new Date("2026-01-15T06:00:00Z") }),
      txn({ occurredAt: new Date("2026-04-15T06:00:00Z") }),
    ]);

    expect(totals.map((t) => t.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(totals[1].incomeMinor).toBe(0);
    expect(totals[1].expenseMinor).toBe(0);
  });

  it("computes net as income minus expense", () => {
    const [month] = monthlyTotals([
      txn({ direction: "credit", amountMinor: 300_000 }),
      txn({ direction: "debit", amountMinor: 125_000 }),
    ]);

    expect(month.netMinor).toBe(175_000);
  });

  it("buckets by Dhaka month, not UTC", () => {
    // 18:30 UTC on 31 Jan is already 1 Feb in Dhaka.
    const totals = monthlyTotals([
      txn({ occurredAt: new Date("2026-01-31T18:30:00Z") }),
    ]);

    expect(totals[0].month).toBe("2026-02");
  });

  it("returns an empty array for no transactions", () => {
    expect(monthlyTotals([])).toEqual([]);
  });

  it("keeps every total an integer", () => {
    const totals = monthlyTotals([
      txn({ direction: "credit", amountMinor: 7 }),
      txn({ direction: "debit", amountMinor: 123_457 }),
    ]);

    for (const value of [
      totals[0].incomeMinor,
      totals[0].expenseMinor,
      totals[0].netMinor,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe("categoryTotals", () => {
  it("shares sum to one across the returned rows", () => {
    const rows = categoryTotals([
      txn({ direction: "debit", amountMinor: 75_000, category: "food" }),
      txn({ direction: "debit", amountMinor: 25_000, category: "transport" }),
    ]);

    const total = rows.reduce((sum, r) => sum + r.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("orders by size, largest first", () => {
    const rows = categoryTotals([
      txn({ direction: "debit", amountMinor: 10_000, category: "food" }),
      txn({ direction: "debit", amountMinor: 90_000, category: "bills" }),
    ]);

    expect(rows[0].category).toBe("bills");
  });

  it("counts transactions per category", () => {
    const rows = categoryTotals([
      txn({ direction: "debit", amountMinor: 1_000, category: "food" }),
      txn({ direction: "debit", amountMinor: 2_000, category: "food" }),
    ]);

    expect(rows[0].count).toBe(2);
  });

  it("returns nothing for an empty ledger", () => {
    expect(categoryTotals([])).toEqual([]);
  });
});

describe("summaryStats", () => {
  it("reports zeros rather than NaN for an empty ledger", () => {
    const stats = summaryStats([], {});

    expect(stats.incomeMinor).toBe(0);
    expect(stats.expenseMinor).toBe(0);
    expect(stats.netMinor).toBe(0);
    expect(stats.txnCount).toBe(0);
    expect(Number.isNaN(stats.avgTxnMinor)).toBe(false);
  });

  it("goes negative when a month spends more than it earns", () => {
    const stats = summaryStats(
      [
        txn({ direction: "credit", amountMinor: 100_000 }),
        txn({ direction: "debit", amountMinor: 250_000 }),
      ],
      { month: "2026-03" },
    );

    expect(stats.netMinor).toBe(-150_000);
  });

  it("restricts to the requested month", () => {
    const stats = summaryStats(
      [
        txn({ occurredAt: new Date("2026-03-10T06:00:00Z"), amountMinor: 10_000 }),
        txn({ occurredAt: new Date("2026-04-10T06:00:00Z"), amountMinor: 99_000 }),
      ],
      { month: "2026-03" },
    );

    expect(stats.expenseMinor).toBe(10_000);
  });
});

describe("month helpers", () => {
  it("enumerates an inclusive range across a year boundary", () => {
    expect(enumerateMonths("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("adds and subtracts months across year boundaries", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
  });

  it("lists the months a ledger actually covers", () => {
    expect(
      availableMonths([
        txn({ occurredAt: new Date("2026-03-10T06:00:00Z") }),
        txn({ occurredAt: new Date("2026-05-10T06:00:00Z") }),
      ]),
    ).toContain("2026-03");
  });

  it("trims the trend to the most recent N months", () => {
    const totals = monthlyTotals([
      txn({ occurredAt: new Date("2025-01-15T06:00:00Z") }),
      txn({ occurredAt: new Date("2026-06-15T06:00:00Z") }),
    ]);

    const trimmed = trailingMonths(totals, 3);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[trimmed.length - 1].month).toBe("2026-06");
  });
});
