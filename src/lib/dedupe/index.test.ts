import { describe, it, expect } from "vitest";

import { dedupeRows, keptRows, summariseDecisions, normaliseRefId } from "./index";
import type { ExtractedRow, Transaction } from "@/lib/core/types";

/**
 * The dedup engine is asymmetric on purpose, and these tests encode that.
 *
 * A MISSED duplicate shows up as a visible double row the user can merge.
 * A WRONGLY merged pair silently deletes a real transaction and can never be
 * noticed. So the tests that matter most here are the false-positive guards —
 * the ones proving two genuinely distinct payments stay distinct.
 */

let seq = 0;

function row(over: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    occurredAt: new Date("2026-03-05T12:00:00Z"),
    amountMinor: 5000,
    direction: "debit",
    currency: "BDT",
    refId: null,
    counterparty: "Shwapno",
    description: "Payment",
    provider: "bkash",
    accountRef: "****4471",
    feeMinor: 0,
    balanceAfterMinor: null,
    rawText: "row",
    ...over,
  };
}

function stored(over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: "11111111-1111-4111-8111-111111111111",
    documentId: null,
    category: null,
    transferPairId: null,
    createdAt: new Date("2026-03-06T00:00:00Z"),
    ...row(),
    ...over,
  } as Transaction;
}

describe("normaliseRefId", () => {
  it("canonicalises the same id rendered differently by two channels", () => {
    expect(normaliseRefId("8H2K9LMN01")).toBe("8H2K9LMN01");
    expect(normaliseRefId("8h2k9lmn01")).toBe("8H2K9LMN01");
    expect(normaliseRefId("TrxID: 8H2-K9L-MN01")).toBe("TRXID8H2K9LMN01");
  });

  it("rejects placeholders that would merge unrelated rows", () => {
    for (const junk of ["N/A", "NIL", "NULL", "0000", "----", "", "ab"]) {
      expect(normaliseRefId(junk)).toBeNull();
    }
    expect(normaliseRefId(null)).toBeNull();
  });
});

describe("false-positive guards", () => {
  it("keeps two same-day, same-amount rickshaw fares as two transactions", () => {
    // The single most important test in this module. Two ৳50 fares on one day
    // are genuinely two payments; collapsing them deletes real spending.
    const incoming = [
      row({
        amountMinor: 5000,
        counterparty: "Rickshaw",
        description: "Rickshaw to office",
        occurredAt: new Date("2026-03-05T03:00:00Z"),
      }),
      row({
        amountMinor: 5000,
        counterparty: "Rickshaw",
        description: "Rickshaw to Mirpur",
        occurredAt: new Date("2026-03-05T13:00:00Z"),
      }),
    ];

    const decisions = dedupeRows(incoming, []);
    expect(decisions.filter((d) => d.isDuplicate)).toHaveLength(0);
    expect(keptRows(decisions)).toHaveLength(2);
  });

  it("keeps rows whose provider ref ids disagree", () => {
    // The provider's own bookkeeping says these are different transactions.
    const existing = [stored({ refId: "AAAA1111" })];
    const incoming = [row({ refId: "BBBB2222" })];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(false);
  });

  it("keeps rows sent to different counterparties", () => {
    const existing = [stored({ counterparty: "01711111111" })];
    const incoming = [row({ counterparty: "01822222222" })];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(false);
  });

  it("keeps rows in opposite directions", () => {
    const existing = [stored({ direction: "credit" })];
    const incoming = [row({ direction: "debit" })];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(false);
  });

  it("keeps rows from different providers", () => {
    const existing = [stored({ provider: "bank" })];
    const incoming = [row({ provider: "bkash" })];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(false);
  });

  it("keeps rows whose amounts differ by a single poisha", () => {
    const existing = [stored({ amountMinor: 5000 })];
    const incoming = [row({ amountMinor: 5001 })];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(false);
  });

  it("keeps rows outside the time window", () => {
    const existing = [stored({ occurredAt: new Date("2026-03-01T12:00:00Z") })];
    const incoming = [row({ occurredAt: new Date("2026-03-05T12:00:00Z") })];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(false);
  });

  it("lets a stored transaction absorb at most one incoming row", () => {
    // Without this cap, two genuinely distinct rows in one upload would both
    // collapse onto the same stored transaction and one would vanish.
    // Batch self-matching is off here so the cap is what is being measured.
    const existing = [stored({ amountMinor: 5000, description: "Payment" })];
    const incoming = [
      row({ amountMinor: 5000, description: "Payment" }),
      row({ amountMinor: 5000, description: "Payment" }),
    ];

    const decisions = dedupeRows(incoming, existing, {
      matchWithinBatch: false,
    });
    expect(decisions.filter((d) => d.isDuplicate)).toHaveLength(1);
    expect(keptRows(decisions)).toHaveLength(1);
  });
});

describe("true-positive matching", () => {
  it("collapses the same TrxID arriving from SMS and from the statement", () => {
    const existing = [stored({ refId: "8H2K9LMN01", description: "SMS alert" })];
    const incoming = [
      row({ refId: "8h2k9lmn01", description: "Statement row" }),
    ];

    const [decision] = dedupeRows(incoming, existing);
    expect(decision.isDuplicate).toBe(true);
    expect(decision.reason).toBe("ref_id");
    expect(decision.existingId).toBe(existing[0].id);
  });

  it("matches a ref id even when every other field differs", () => {
    // An id is an identity. Two channels phrase the same payment differently.
    const existing = [
      stored({
        refId: "TRX99887766",
        description: "BKASH PAYMENT",
        counterparty: null,
      }),
    ];
    const incoming = [
      row({
        refId: "TRX99887766",
        description: "Payment to Shwapno Ltd",
        counterparty: "Shwapno",
      }),
    ];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(true);
  });

  it("collapses differently-worded rows for the same counterparty", () => {
    // Statement and SMS phrase the same payment differently. With the
    // counterparty agreeing and the descriptions close, this is a duplicate.
    const existing = [
      stored({
        description: "BKASH PAYMENT SHWAPNO TrxID 8H2K9LMN01",
        counterparty: "Shwapno",
        occurredAt: new Date("2026-03-05T10:00:00Z"),
      }),
    ];
    const incoming = [
      row({
        description: "Payment SHWAPNO successful",
        counterparty: "SHWAPNO",
        occurredAt: new Date("2026-03-05T14:00:00Z"),
      }),
    ];

    const [decision] = dedupeRows(incoming, existing);
    expect(decision.isDuplicate).toBe(true);
    expect(decision.reason).toBe("fuzzy_match");
  });

  it("deliberately keeps a cosmetic counterparty variant as two rows", () => {
    // "Shwapno" vs "Shwapno Ltd" scores just under the bar, so fuzzy matching
    // declines. This is the intended direction of failure: a visible double row
    // beats a silent deletion, and the ref-id tier catches this case in
    // practice because bKash stamps every transaction with a TrxID.
    const existing = [stored({ counterparty: "SHWAPNO", description: "Payment" })];
    const incoming = [row({ counterparty: "Shwapno Ltd", description: "Payment" })];

    expect(dedupeRows(incoming, existing)[0].isDuplicate).toBe(false);
  });

  it("catches a row listed twice within one statement", () => {
    // Page breaks make statements repeat rows.
    const incoming = [row({ refId: "DUP12345" }), row({ refId: "DUP12345" })];

    const decisions = dedupeRows(incoming, []);
    expect(decisions[0].isDuplicate).toBe(false);
    expect(decisions[1].isDuplicate).toBe(true);
    expect(decisions[1].duplicateOfIndex).toBe(0);
  });

  it("resolves a third copy to the original, not to the second copy", () => {
    const incoming = [
      row({ refId: "TRIPLE01" }),
      row({ refId: "TRIPLE01" }),
      row({ refId: "TRIPLE01" }),
    ];

    const decisions = dedupeRows(incoming, []);
    expect(keptRows(decisions)).toHaveLength(1);
    expect(decisions[2].duplicateOfIndex).toBe(0);
  });

  it("can be told not to match within the batch", () => {
    const incoming = [row({ refId: "DUP12345" }), row({ refId: "DUP12345" })];

    const decisions = dedupeRows(incoming, [], { matchWithinBatch: false });
    expect(keptRows(decisions)).toHaveLength(2);
  });
});

describe("determinism and edges", () => {
  it("returns one decision per incoming row, in input order", () => {
    const incoming = [row({ refId: "A1111111" }), row({ refId: "B2222222" })];
    const decisions = dedupeRows(incoming, []);

    expect(decisions).toHaveLength(2);
    expect(decisions[0].row.refId).toBe("A1111111");
    expect(decisions[1].row.refId).toBe("B2222222");
  });

  it("produces identical output for identical input", () => {
    const incoming = [row({ refId: "A1111111" }), row({ description: "x" })];
    const existing = [stored({ refId: "A1111111" })];

    const first = dedupeRows(incoming, existing);
    const second = dedupeRows(incoming, existing);

    expect(first.map((d) => [d.isDuplicate, d.reason])).toEqual(
      second.map((d) => [d.isDuplicate, d.reason]),
    );
  });

  it("mutates neither input array", () => {
    const incoming = [row()];
    const existing = [stored()];
    const incomingCopy = structuredClone(incoming);

    dedupeRows(incoming, existing);
    expect(incoming).toEqual(incomingCopy);
  });

  it("handles empty inputs", () => {
    expect(dedupeRows([], [])).toEqual([]);
    expect(dedupeRows([], [stored()])).toEqual([]);
    expect(dedupeRows([row()], [])).toHaveLength(1);
  });
});

describe("summariseDecisions", () => {
  it("counts inserts and duplicates by reason", () => {
    const existing = [stored({ refId: "KNOWN123" })];
    const incoming = [
      row({ refId: "KNOWN123" }),
      row({ refId: "NEW45678" }),
    ];

    const summary = summariseDecisions(dedupeRows(incoming, existing));
    expect(summary.total).toBe(2);
    expect(summary.inserted).toBe(1);
    expect(summary.duplicates).toBe(1);
    expect(summary.byReason.ref_id).toBe(1);
  });
});
