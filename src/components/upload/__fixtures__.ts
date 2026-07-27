/**
 * Fixtures for the upload UI.
 *
 * The numbers here are internally consistent on purpose: `verifiedReconcile`
 * really is the arithmetic of `sampleRows`, so a component that renders totals
 * can be trusted in a test. `failedReconcile` reuses the same rows with a
 * deliberately unmatched declared closing balance — the shape you get when the
 * extractor drops a line.
 */

import type {
  ExtractedRow,
  ReconcileResult,
} from "@/lib/core/types";
import type { WireDocument, WireExtractedRow } from "./contract";

function row(input: {
  occurredAt: string;
  amountMinor: number;
  direction: "credit" | "debit";
  description: string;
  counterparty?: string | null;
  refId?: string | null;
  feeMinor?: number;
  balanceAfterMinor?: number | null;
}): ExtractedRow {
  return {
    occurredAt: new Date(input.occurredAt),
    amountMinor: input.amountMinor,
    direction: input.direction,
    currency: "BDT",
    refId: input.refId ?? null,
    counterparty: input.counterparty ?? null,
    description: input.description,
    provider: "bkash",
    accountRef: "****4471",
    feeMinor: input.feeMinor ?? 0,
    balanceAfterMinor: input.balanceAfterMinor ?? null,
    rawText: `${input.occurredAt} ${input.description}`,
  };
}

/** Opening balance 12,450.00 → closing 47,614.50. */
export const OPENING_BALANCE_MINOR = 1_245_000;
export const CLOSING_BALANCE_MINOR = 4_761_450;

export const sampleRows: ExtractedRow[] = [
  row({
    occurredAt: "2026-06-02T09:14:00.000Z",
    amountMinor: 500_000,
    direction: "credit",
    description: "Cash In from Agent",
    counterparty: "Agent 01711223344",
    refId: "CF62A1B9K3",
    balanceAfterMinor: 1_745_000,
  }),
  row({
    occurredAt: "2026-06-05T13:02:00.000Z",
    amountMinor: 234_550,
    direction: "debit",
    description: "Payment",
    counterparty: "Shwapno Gulshan",
    refId: "CF75D2C4M1",
    balanceAfterMinor: 1_510_450,
  }),
  row({
    occurredAt: "2026-06-09T18:41:00.000Z",
    amountMinor: 200_000,
    direction: "debit",
    description: "Send Money",
    counterparty: "01812345678",
    refId: "CF81E9F7P2",
    feeMinor: 500,
    balanceAfterMinor: 1_309_950,
  }),
  row({
    occurredAt: "2026-06-14T07:25:00.000Z",
    amountMinor: 30_000,
    direction: "debit",
    description: "Mobile Recharge",
    counterparty: "01711223344",
    refId: "CF90A3B2Q8",
    balanceAfterMinor: 1_279_950,
  }),
  row({
    occurredAt: "2026-06-21T11:00:00.000Z",
    amountMinor: 4_500_000,
    direction: "credit",
    description: "Salary Disbursement",
    counterparty: "Beximco Ltd",
    refId: "CG14C8D5R6",
    balanceAfterMinor: 5_779_950,
  }),
  row({
    occurredAt: "2026-06-28T16:30:00.000Z",
    amountMinor: 1_000_000,
    direction: "debit",
    description: "Cash Out",
    counterparty: "ATM Banani 11",
    refId: "CG27F1G9S4",
    feeMinor: 18_500,
    balanceAfterMinor: 4_761_450,
  }),
];

export const TOTAL_CREDITS_MINOR = 5_000_000;
export const TOTAL_DEBITS_MINOR = 1_464_550;
export const TOTAL_FEES_MINOR = 19_000;

export const verifiedReconcile: ReconcileResult = {
  status: "verified",
  deltaMinor: 0,
  openingBalanceMinor: OPENING_BALANCE_MINOR,
  closingBalanceMinor: CLOSING_BALANCE_MINOR,
  computedClosingMinor: CLOSING_BALANCE_MINOR,
  totalCreditsMinor: TOTAL_CREDITS_MINOR,
  totalDebitsMinor: TOTAL_DEBITS_MINOR,
  totalFeesMinor: TOTAL_FEES_MINOR,
  rowCount: sampleRows.length,
  message: "Computed closing balance matches the statement exactly.",
};

/** Extractor missed 1,150.00 of spending, so we land above the real closing. */
export const RECONCILE_DELTA_MINOR = 115_000;

export const failedReconcile: ReconcileResult = {
  status: "failed",
  deltaMinor: RECONCILE_DELTA_MINOR,
  openingBalanceMinor: OPENING_BALANCE_MINOR,
  closingBalanceMinor: CLOSING_BALANCE_MINOR,
  computedClosingMinor: CLOSING_BALANCE_MINOR + RECONCILE_DELTA_MINOR,
  totalCreditsMinor: TOTAL_CREDITS_MINOR,
  totalDebitsMinor: TOTAL_DEBITS_MINOR - RECONCILE_DELTA_MINOR,
  totalFeesMinor: TOTAL_FEES_MINOR,
  rowCount: sampleRows.length,
  message:
    "Computed closing balance is 1,150.00 higher than the statement's own closing balance.",
};

/** Rows the pipeline flagged: the two with fees, where parsing goes wrong. */
export const suspectRowIndexes = [2, 5];

export const sampleDocument: WireDocument = {
  id: "8f1d6e30-9c1a-4a1f-9f3b-3f0c2a5d7e11",
  filename: "bkash-statement-june-2026.pdf",
  provider: "bkash",
  currency: "BDT",
  periodStart: "2026-06-01T00:00:00.000Z",
  periodEnd: "2026-06-30T00:00:00.000Z",
  openingBalanceMinor: OPENING_BALANCE_MINOR,
  closingBalanceMinor: CLOSING_BALANCE_MINOR,
  reconcileStatus: "verified",
  reconcileDeltaMinor: 0,
  rowCount: sampleRows.length,
  createdAt: "2026-07-02T05:20:00.000Z",
};

export const failedDocument: WireDocument = {
  ...sampleDocument,
  id: "2c9b0a44-51de-4e8b-a0c9-6b7d8e2f4a03",
  reconcileStatus: "failed",
  reconcileDeltaMinor: RECONCILE_DELTA_MINOR,
};

/** The already-imported document a duplicate upload collides with. */
export const duplicateDocument: WireDocument = {
  ...sampleDocument,
  createdAt: "2026-06-30T11:45:00.000Z",
};

export const sampleWireRows: WireExtractedRow[] = sampleRows.map((r) => ({
  ...r,
  occurredAt: r.occurredAt.toISOString(),
}));
