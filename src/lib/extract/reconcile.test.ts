import { describe, it, expect } from "vitest";

import { reconcile, findLikelyCulprits } from "./reconcile";
import type { ExtractedRow, StatementExtraction } from "@/lib/core/types";

/**
 * Reconciliation is the mechanism that makes an LLM safe to point at money.
 * The model fails plausibly rather than loudly, so these tests care most about
 * one property: a statement whose rows do NOT add up must never come back
 * `verified`.
 */

function makeRow(over: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    occurredAt: new Date("2026-03-05T06:00:00Z"),
    amountMinor: 10000,
    direction: "debit",
    currency: "BDT",
    refId: null,
    counterparty: "Shwapno",
    description: "Grocery",
    provider: "bkash",
    accountRef: "****4471",
    feeMinor: 0,
    balanceAfterMinor: null,
    rawText: "05/03/2026 Grocery Shwapno 100.00",
    ...over,
  };
}

function makeStatement(over: Partial<StatementExtraction> = {}): StatementExtraction {
  return {
    provider: "bkash",
    accountRef: "****4471",
    currency: "BDT",
    periodStart: "01/03/2026",
    periodEnd: "31/03/2026",
    openingBalanceMinor: 0,
    closingBalanceMinor: 0,
    rows: [],
    ...over,
  };
}

describe("reconcile", () => {
  describe("verified", () => {
    it("passes when credits minus debits lands exactly on the closing balance", () => {
      const result = reconcile(
        makeStatement({
          openingBalanceMinor: 100_000,
          closingBalanceMinor: 130_000,
          rows: [
            makeRow({ direction: "credit", amountMinor: 50_000 }),
            makeRow({ direction: "debit", amountMinor: 20_000 }),
          ],
        }),
      );

      expect(result.status).toBe("verified");
      expect(result.deltaMinor).toBe(0);
      expect(result.totalCreditsMinor).toBe(50_000);
      expect(result.totalDebitsMinor).toBe(20_000);
      expect(result.rowCount).toBe(2);
    });

    it("subtracts fees on top of the debited amount", () => {
      // bKash charges a fee alongside a send-money. It leaves the balance but
      // is not its own transaction, so it must reduce the computed closing.
      const result = reconcile(
        makeStatement({
          openingBalanceMinor: 100_000,
          closingBalanceMinor: 79_150,
          rows: [makeRow({ direction: "debit", amountMinor: 20_000, feeMinor: 850 })],
        }),
      );

      expect(result.status).toBe("verified");
      expect(result.totalFeesMinor).toBe(850);
    });

    it("verifies an empty statement with equal opening and closing", () => {
      const result = reconcile(
        makeStatement({ openingBalanceMinor: 42_000, closingBalanceMinor: 42_000 }),
      );

      expect(result.status).toBe("verified");
      expect(result.rowCount).toBe(0);
    });

    it("handles a realistic multi-row statement without drift", () => {
      const rows = [
        makeRow({ direction: "credit", amountMinor: 4_500_000 }),
        makeRow({ direction: "debit", amountMinor: 123_456 }),
        makeRow({ direction: "debit", amountMinor: 7 }),
        makeRow({ direction: "debit", amountMinor: 89_999, feeMinor: 743 }),
        makeRow({ direction: "credit", amountMinor: 50 }),
      ];
      const opening = 1_000_000;
      const closing = opening + 4_500_000 + 50 - 123_456 - 7 - 89_999 - 743;

      const result = reconcile(
        makeStatement({
          openingBalanceMinor: opening,
          closingBalanceMinor: closing,
          rows,
        }),
      );

      expect(result.status).toBe("verified");
      expect(result.deltaMinor).toBe(0);
    });
  });

  describe("failed", () => {
    it("fails when a single poisha is missing", () => {
      // One poisha is the smallest possible extraction error, and it must still
      // fail. Any tolerance here would let real digit errors through.
      const result = reconcile(
        makeStatement({
          openingBalanceMinor: 100_000,
          closingBalanceMinor: 90_001,
          rows: [makeRow({ direction: "debit", amountMinor: 10_000 })],
        }),
      );

      expect(result.status).toBe("failed");
      expect(result.deltaMinor).toBe(-1);
    });

    it("reports delta as computed minus declared", () => {
      const result = reconcile(
        makeStatement({
          openingBalanceMinor: 100_000,
          closingBalanceMinor: 80_000,
          rows: [makeRow({ direction: "debit", amountMinor: 10_000 })],
        }),
      );

      // computed = 100000 - 10000 = 90000; declared = 80000; delta = +10000
      expect(result.status).toBe("failed");
      expect(result.computedClosingMinor).toBe(90_000);
      expect(result.deltaMinor).toBe(10_000);
    });

    it("names the gap in the message", () => {
      const result = reconcile(
        makeStatement({
          openingBalanceMinor: 100_000,
          closingBalanceMinor: 50_000,
          rows: [makeRow({ direction: "debit", amountMinor: 10_000 })],
        }),
      );

      expect(result.status).toBe("failed");
      expect(result.message).toMatch(/\d/);
      expect(result.message.length).toBeGreaterThan(10);
    });

    it("fails a dropped row", () => {
      // The most likely real failure: the model skipped a line.
      const opening = 500_000;
      const allRows = [
        makeRow({ direction: "debit", amountMinor: 100_000 }),
        makeRow({ direction: "debit", amountMinor: 75_000 }),
      ];
      const trueClosing = opening - 175_000;

      const result = reconcile(
        makeStatement({
          openingBalanceMinor: opening,
          closingBalanceMinor: trueClosing,
          rows: [allRows[0]],
        }),
      );

      expect(result.status).toBe("failed");
      expect(result.deltaMinor).toBe(75_000);
    });
  });

  describe("not_applicable", () => {
    it("returns not_applicable when both balances are absent", () => {
      // Email alerts and SMS carry no balances. Their rows are provisional
      // rather than proven, and must not masquerade as verified.
      const result = reconcile(
        makeStatement({
          openingBalanceMinor: null,
          closingBalanceMinor: null,
          rows: [makeRow()],
        }),
      );

      expect(result.status).toBe("not_applicable");
      expect(result.status).not.toBe("verified");
    });

    it("returns not_applicable when only the closing balance is missing", () => {
      const result = reconcile(
        makeStatement({ openingBalanceMinor: 100_000, closingBalanceMinor: null }),
      );

      expect(result.status).toBe("not_applicable");
    });

    it("returns not_applicable when only the opening balance is missing", () => {
      const result = reconcile(
        makeStatement({ openingBalanceMinor: null, closingBalanceMinor: 100_000 }),
      );

      expect(result.status).toBe("not_applicable");
    });
  });

  describe("float rejection", () => {
    it("throws rather than reconciling a float amount", () => {
      expect(() =>
        reconcile(
          makeStatement({
            openingBalanceMinor: 100_000,
            closingBalanceMinor: 90_000,
            rows: [makeRow({ amountMinor: 10_000.5 })],
          }),
        ),
      ).toThrow(/integer minor units/i);
    });

    it("throws on a float fee", () => {
      expect(() =>
        reconcile(
          makeStatement({
            openingBalanceMinor: 100_000,
            closingBalanceMinor: 90_000,
            rows: [makeRow({ feeMinor: 8.5 })],
          }),
        ),
      ).toThrow(/integer minor units/i);
    });

    it("throws on a float opening balance", () => {
      expect(() =>
        reconcile(
          makeStatement({
            openingBalanceMinor: 100_000.25,
            closingBalanceMinor: 90_000,
            rows: [],
          }),
        ),
      ).toThrow(/integer minor units/i);
    });
  });
});

describe("findLikelyCulprits", () => {
  it("returns nothing when the statement balanced", () => {
    expect(findLikelyCulprits(makeStatement(), 0)).toEqual([]);
  });

  it("spots a flipped direction", () => {
    // A ৳200 debit extracted as a credit moves the computed closing by +400:
    // the delta is exactly twice the row's effect.
    const rows = [
      makeRow({ direction: "credit", amountMinor: 20_000, description: "Bill" }),
    ];
    const culprits = findLikelyCulprits(makeStatement({ rows }), 2 * 20_000);

    const flip = culprits.find((c) => c.kind === "sign_flip");
    expect(flip).toBeDefined();
    expect(flip!.rowIndex).toBe(0);
    expect(flip!.confidence).toBeGreaterThan(0.7);
    expect(flip!.message).toMatch(/row 1/i);
  });

  it("spots a row that should not be there", () => {
    // A hallucinated or double-counted row: removing it closes the gap exactly.
    const rows = [
      makeRow({ direction: "debit", amountMinor: 33_000, description: "Ghost" }),
    ];
    const culprits = findLikelyCulprits(makeStatement({ rows }), -33_000);

    expect(culprits.some((c) => c.kind === "extra_row")).toBe(true);
  });

  it("points at the right row among several", () => {
    const rows = [
      makeRow({ direction: "debit", amountMinor: 10_000, description: "A" }),
      makeRow({ direction: "debit", amountMinor: 25_000, description: "B" }),
      makeRow({ direction: "debit", amountMinor: 40_000, description: "C" }),
    ];
    const culprits = findLikelyCulprits(makeStatement({ rows }), 2 * -25_000);

    expect(culprits.length).toBeGreaterThan(0);
    expect(culprits[0].rowIndex).toBe(1);
    expect(culprits[0].row.description).toBe("B");
  });

  it("stays quiet when no single row explains the gap", () => {
    // Better to say nothing than to accuse an innocent row.
    const rows = [
      makeRow({ direction: "debit", amountMinor: 10_000 }),
      makeRow({ direction: "debit", amountMinor: 20_000 }),
    ];
    const culprits = findLikelyCulprits(makeStatement({ rows }), 7_777);

    expect(culprits).toEqual([]);
  });
});
