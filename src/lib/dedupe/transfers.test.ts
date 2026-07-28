import { describe, it, expect } from "vitest";

import {
  findTransferPairs,
  transferLegIds,
  allowedFeeGapMinor,
  DEFAULT_FEE_RATE,
  DEFAULT_FLAT_FEE_MINOR,
  DEFAULT_MAX_FEE_MINOR,
} from "./transfers";
import type { Transaction } from "@/lib/core/types";

/**
 * Own-account transfers are the one thing that inflates income and spending at
 * the same time — and because the net stays right, the error hides itself. A
 * user topping up ৳10,000 a month looks like they earn ৳10,000 more AND spend
 * ৳10,000 more than they do.
 *
 * The failure directions are not symmetric, so the tests are not either:
 *   - MISSING a pair leaves two visible rows the user can see and correct.
 *   - INVENTING a pair erases real income and real spending from every chart.
 * Ambiguity must therefore resolve to "not a transfer".
 */

let seq = 0;

function txn(over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: "11111111-1111-4111-8111-111111111111",
    documentId: null,
    occurredAt: new Date("2026-03-05T12:00:00Z"),
    amountMinor: 1_000_000,
    direction: "debit",
    currency: "BDT",
    refId: null,
    counterparty: null,
    description: "Add Money",
    provider: "bank",
    accountRef: null,
    feeMinor: 0,
    balanceAfterMinor: null,
    category: null,
    rawText: "row",
    transferPairId: null,
    createdAt: new Date("2026-03-06T00:00:00Z"),
    ...over,
  };
}

/** The canonical case: bank card debited, bKash wallet credited moments later. */
function addMoneyPair(over: { amountOut?: number; amountIn?: number; gapMs?: number } = {}) {
  const start = new Date("2026-03-05T12:00:00Z");
  return [
    txn({
      direction: "debit",
      provider: "bank",
      amountMinor: over.amountOut ?? 1_000_000,
      description: "Add Money to bKash",
      occurredAt: start,
    }),
    txn({
      direction: "credit",
      provider: "bkash",
      amountMinor: over.amountIn ?? 1_000_000,
      description: "Add Money from bank",
      occurredAt: new Date(start.getTime() + (over.gapMs ?? 30_000)),
    }),
  ];
}

describe("allowedFeeGapMinor", () => {
  const opts = {
    feeRate: DEFAULT_FEE_RATE,
    flatFeeMinor: DEFAULT_FLAT_FEE_MINOR,
    maxFeeMinor: DEFAULT_MAX_FEE_MINOR,
  };

  it("uses the flat floor for small transfers", () => {
    // 2% of ৳100 is ৳2, but a ৳5 send-money fee still has to reconcile.
    expect(allowedFeeGapMinor(10_000, opts)).toBe(DEFAULT_FLAT_FEE_MINOR);
  });

  it("scales with the principal in the middle", () => {
    expect(allowedFeeGapMinor(1_000_000, opts)).toBe(20_000);
  });

  it("caps absolutely so a big transfer cannot reach an unrelated row", () => {
    expect(allowedFeeGapMinor(100_000_000, opts)).toBe(DEFAULT_MAX_FEE_MINOR);
  });
});

describe("finding real transfers", () => {
  it("pairs a bank debit with the matching wallet credit", () => {
    const [out, into] = addMoneyPair();
    const pairs = findTransferPairs([out, into]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].outLegRefId).toBe(out.id);
    expect(pairs[0].inLegRefId).toBe(into.id);
    expect(pairs[0].amountMinor).toBe(1_000_000);
  });

  it("pairs legs that differ by a plausible provider fee", () => {
    // The card is debited ৳1,018.50 and ৳1,000 lands in the wallet.
    const [out, into] = addMoneyPair({ amountOut: 101_850, amountIn: 100_000 });
    const pairs = findTransferPairs([out, into]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].feeGapMinor).toBe(1_850);
  });

  it("reports which way the money moved", () => {
    const [out, into] = addMoneyPair();
    const [pair] = findTransferPairs([out, into]);

    expect(pair.reason).toContain("bank");
    expect(pair.reason).toContain("bkash");
  });

  it("exposes both legs for analytics to exclude", () => {
    const [out, into] = addMoneyPair();
    const ids = transferLegIds(findTransferPairs([out, into]));

    expect(ids.has(out.id)).toBe(true);
    expect(ids.has(into.id)).toBe(true);
    expect(ids.size).toBe(2);
  });
});

describe("false-positive guards", () => {
  it("does not pair two debits", () => {
    // A transfer is opposite directions. Same direction is either a duplicate
    // or two real payments — never one movement.
    const rows = [
      txn({ direction: "debit", provider: "bank" }),
      txn({ direction: "debit", provider: "bkash" }),
    ];
    expect(findTransferPairs(rows)).toEqual([]);
  });

  it("does not pair two credits", () => {
    const rows = [
      txn({ direction: "credit", provider: "bank" }),
      txn({ direction: "credit", provider: "bkash" }),
    ];
    expect(findTransferPairs(rows)).toEqual([]);
  });

  it("does not pair legs on the same provider", () => {
    // Both legs inside bKash is a payment to someone else, not a self-transfer.
    const [out, into] = addMoneyPair();
    const rows = [out, { ...into, provider: "bank" as const }];
    expect(findTransferPairs(rows)).toEqual([]);
  });

  it("does not pair legs outside the time window", () => {
    const [out, into] = addMoneyPair({ gapMs: 6 * 60 * 60 * 1000 });
    expect(findTransferPairs([out, into])).toEqual([]);
  });

  it("does not pair amounts a fee cannot explain", () => {
    // Salary in and rent out on the same morning are not a transfer.
    const [out, into] = addMoneyPair({ amountOut: 1_000_000, amountIn: 400_000 });
    expect(findTransferPairs([out, into])).toEqual([]);
  });

  it("ignores a salary credit sitting near an unrelated payment", () => {
    const rows = [
      txn({
        direction: "credit",
        provider: "bank",
        amountMinor: 5_000_000,
        description: "Salary March",
        counterparty: "Employer Ltd",
      }),
      txn({
        direction: "debit",
        provider: "bkash",
        amountMinor: 5_000_000,
        description: "Payment to Shwapno",
        counterparty: "Shwapno",
        occurredAt: new Date("2026-03-05T12:10:00Z"),
      }),
    ];

    // No transfer vocabulary and no fee relationship: this must stay two rows.
    expect(findTransferPairs(rows)).toEqual([]);
  });

  it("never uses one row in two pairs", () => {
    // Two credits could each match the same debit; only one link may survive,
    // otherwise a real transaction is netted away twice.
    const start = new Date("2026-03-05T12:00:00Z");
    const rows = [
      txn({ direction: "debit", provider: "bank", description: "Add Money", occurredAt: start }),
      txn({
        direction: "credit",
        provider: "bkash",
        description: "Add Money",
        occurredAt: new Date(start.getTime() + 20_000),
      }),
      txn({
        direction: "credit",
        provider: "nagad",
        description: "Add Money",
        occurredAt: new Date(start.getTime() + 40_000),
      }),
    ];

    const pairs = findTransferPairs(rows);
    expect(pairs).toHaveLength(1);

    const ids = transferLegIds(pairs);
    expect(ids.size).toBe(2);
  });

  it("skips rows already linked to a pair", () => {
    const [out, into] = addMoneyPair();
    const settled = [
      { ...out, transferPairId: "33333333-3333-4333-8333-333333333333" },
      { ...into, transferPairId: "33333333-3333-4333-8333-333333333333" },
    ];

    expect(findTransferPairs(settled)).toEqual([]);
    expect(findTransferPairs(settled, { includeAlreadyPaired: true })).toHaveLength(1);
  });

  it("requires positive evidence, not just matching amounts and timing", () => {
    // Same amount, opposite directions, minutes apart, different providers —
    // every structural gate passes. Nothing says "self-transfer", so it must
    // not be linked. This is the salary-and-rent coincidence.
    const rows = [
      txn({
        direction: "debit",
        provider: "bank",
        amountMinor: 2_500_000,
        description: "Cheque withdrawal",
        counterparty: null,
      }),
      txn({
        direction: "credit",
        provider: "bkash",
        amountMinor: 2_500_000,
        description: "Received payment",
        counterparty: null,
        occurredAt: new Date("2026-03-05T12:05:00Z"),
      }),
    ];

    expect(findTransferPairs(rows)).toEqual([]);
  });

  it("scores a textbook transfer near the top and honours the bar", () => {
    const [out, into] = addMoneyPair();

    const [pair] = findTransferPairs([out, into]);
    expect(pair.confidence).toBeGreaterThan(0.9);

    // A bar above its score filters it out.
    expect(
      findTransferPairs([out, into], { minConfidence: pair.confidence + 0.001 }),
    ).toEqual([]);
  });
});

describe("determinism and edges", () => {
  it("produces the same pairs regardless of input order", () => {
    const [out, into] = addMoneyPair();

    const forward = findTransferPairs([out, into]);
    const backward = findTransferPairs([into, out]);

    expect(forward.map((p) => [p.outLegRefId, p.inLegRefId])).toEqual(
      backward.map((p) => [p.outLegRefId, p.inLegRefId]),
    );
  });

  it("does not mutate its input", () => {
    const rows = addMoneyPair();
    const before = structuredClone(rows);
    findTransferPairs(rows);
    expect(rows).toEqual(before);
  });

  it("handles empty and single-row input", () => {
    expect(findTransferPairs([])).toEqual([]);
    expect(findTransferPairs([txn()])).toEqual([]);
  });

  it("ignores zero-amount rows", () => {
    const rows = [
      txn({ direction: "debit", provider: "bank", amountMinor: 0 }),
      txn({ direction: "credit", provider: "bkash", amountMinor: 0 }),
    ];
    expect(findTransferPairs(rows)).toEqual([]);
  });

  it("returns an empty id set for no pairs", () => {
    expect(transferLegIds([]).size).toBe(0);
  });
});
