/**
 * Arithmetic proof of an extraction.
 *
 * An LLM reading a statement is a guess. This file is what turns the guess into
 * something you can bank on: the statement declares its own opening and closing
 * balance, so replaying the extracted rows over the opening balance must land
 * exactly on the closing balance. Off by one poisha and the extraction is
 * wrong — a dropped row, a flipped sign, a misread digit — and we say so
 * instead of quietly filing bad numbers.
 *
 *   computed = opening + credits − debits − fees
 *
 * Everything is integer minor units. A single float in this file would produce
 * mismatches indistinguishable from real extraction errors.
 */

import { formatMoney } from "@/lib/core/money";
import type {
  ExtractedRow,
  ReconcileResult,
  StatementExtraction,
} from "@/lib/core/types";

export interface ReconcileTotals {
  totalCreditsMinor: number;
  totalDebitsMinor: number;
  totalFeesMinor: number;
  rowCount: number;
}

/**
 * Prove (or disprove) an extraction against the balances the statement itself
 * declares.
 *
 * - `verified`       — computed lands exactly on the declared closing balance
 * - `failed`         — it does not; `deltaMinor` is computed − declared
 * - `not_applicable` — the document declares no balances (SMS, email alert),
 *                      so there is nothing to check the rows against
 */
/** One consecutive pair of rows whose running balances disagree. */
export interface BalanceBreak {
  /** Index of the row whose balance does not follow from the row before it. */
  rowIndex: number;
  /** balanceAfter[i] − (balanceAfter[i−1] + effect[i]). Non-zero by definition. */
  deltaMinor: number;
}

export interface BalanceChainResult {
  /** Consecutive pairs that could be compared. */
  checkedPairs: number;
  breaks: BalanceBreak[];
  /** Balance before the first row, derived from it. Null if unavailable. */
  derivedOpeningMinor: number | null;
  /** Balance after the last row. Null if unavailable. */
  derivedClosingMinor: number | null;
}

/**
 * Verify a statement against its own running-balance column.
 *
 * Real bKash statements print no "opening balance" or "closing balance" line —
 * only a Balance column on every row. Without this check they reconcile as
 * `not_applicable`, which means the app's central promise never actually fires
 * for its primary source and unverified figures reach the ledger.
 *
 * The chain is also a STRONGER proof than opening-plus-closing: instead of one
 * end-to-end sum that says only "something is wrong somewhere", it verifies
 * every row individually and names the exact row where the arithmetic breaks.
 */
export function verifyBalanceChain(
  rows: readonly ExtractedRow[],
): BalanceChainResult {
  const breaks: BalanceBreak[] = [];
  let checkedPairs = 0;
  let derivedOpeningMinor: number | null = null;

  const balanceOf = (row: ExtractedRow): number | null =>
    typeof row.balanceAfterMinor === "number" ? row.balanceAfterMinor : null;

  const firstBalance = rows.length > 0 ? balanceOf(rows[0]) : null;
  if (firstBalance !== null) {
    derivedOpeningMinor = firstBalance - rowEffect(rows[0]);
  }

  for (let i = 1; i < rows.length; i++) {
    const previous = balanceOf(rows[i - 1]);
    const current = balanceOf(rows[i]);
    if (previous === null || current === null) continue;

    checkedPairs += 1;
    const expected = previous + rowEffect(rows[i]);
    const delta = current - expected;
    if (delta !== 0) breaks.push({ rowIndex: i, deltaMinor: delta });
  }

  let derivedClosingMinor: number | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const balance = balanceOf(rows[i]);
    if (balance !== null) {
      derivedClosingMinor = balance;
      break;
    }
  }

  return { checkedPairs, breaks, derivedOpeningMinor, derivedClosingMinor };
}

export function reconcile(extraction: StatementExtraction): ReconcileResult {
  const totals = sumRows(extraction.rows);
  const currency = extraction.currency ?? "BDT";

  let opening = extraction.openingBalanceMinor;
  let closing = extraction.closingBalanceMinor;

  // No declared balances, but the rows carry a running balance column: verify
  // against that instead. This is the normal shape of a bKash statement.
  if (opening === null || closing === null) {
    const chain = verifyBalanceChain(extraction.rows);

    if (chain.checkedPairs > 0) {
      if (chain.breaks.length > 0) {
        const first = chain.breaks[0];
        return {
          status: "failed",
          deltaMinor: first.deltaMinor,
          openingBalanceMinor: chain.derivedOpeningMinor,
          closingBalanceMinor: chain.derivedClosingMinor,
          computedClosingMinor: chain.derivedClosingMinor,
          ...totals,
          message:
            `Row ${first.rowIndex + 1} does not follow from the balance on the ` +
            `row before it — the running balance is out by ` +
            `${formatMoney(Math.abs(first.deltaMinor), currency)}. ` +
            (chain.breaks.length > 1
              ? `${chain.breaks.length} rows break the chain in total.`
              : `Every other row checks out.`),
        };
      }

      // Every consecutive pair agrees, so each row is individually proven.
      opening = chain.derivedOpeningMinor;
      closing = chain.derivedClosingMinor;

      if (opening !== null && closing !== null) {
        return {
          status: "verified",
          deltaMinor: 0,
          openingBalanceMinor: opening,
          closingBalanceMinor: closing,
          computedClosingMinor: closing,
          ...totals,
          message:
            `All ${totals.rowCount} rows follow their running balance exactly, ` +
            `ending at ${formatMoney(closing, currency)}.`,
        };
      }
    }
  }

  if (opening === null || closing === null) {
    return {
      status: "not_applicable",
      deltaMinor: 0,
      openingBalanceMinor: opening,
      closingBalanceMinor: closing,
      computedClosingMinor:
        opening === null ? null : opening + netMovement(totals),
      ...totals,
      message: notApplicableMessage(opening, closing, totals, currency),
    };
  }

  assertMinorUnits(opening, "openingBalanceMinor");
  assertMinorUnits(closing, "closingBalanceMinor");

  const computed = opening + netMovement(totals);
  const delta = computed - closing;

  if (delta === 0) {
    return {
      status: "verified",
      deltaMinor: 0,
      openingBalanceMinor: opening,
      closingBalanceMinor: closing,
      computedClosingMinor: computed,
      ...totals,
      message:
        `Verified: ${totals.rowCount} ${plural(totals.rowCount, "row", "rows")} replay exactly ` +
        `from ${formatMoney(opening, currency)} to the declared closing balance of ` +
        `${formatMoney(closing, currency)}.`,
    };
  }

  return {
    status: "failed",
    deltaMinor: delta,
    openingBalanceMinor: opening,
    closingBalanceMinor: closing,
    computedClosingMinor: computed,
    ...totals,
    message: failureMessage(extraction, computed, closing, delta, totals, currency),
  };
}

/** Net effect of every row on the balance: credits in, debits and fees out. */
function netMovement(totals: ReconcileTotals): number {
  return totals.totalCreditsMinor - totals.totalDebitsMinor - totals.totalFeesMinor;
}

function sumRows(rows: readonly ExtractedRow[]): ReconcileTotals {
  let totalCreditsMinor = 0;
  let totalDebitsMinor = 0;
  let totalFeesMinor = 0;

  rows.forEach((row, index) => {
    assertMinorUnits(row.amountMinor, `rows[${index}].amountMinor`);
    assertMinorUnits(row.feeMinor, `rows[${index}].feeMinor`);

    if (row.direction === "credit") totalCreditsMinor += row.amountMinor;
    else totalDebitsMinor += row.amountMinor;

    totalFeesMinor += row.feeMinor;
  });

  return {
    totalCreditsMinor,
    totalDebitsMinor,
    totalFeesMinor,
    rowCount: rows.length,
  };
}

/**
 * A float here would be a silent correctness bug, so it is a loud one instead.
 * Rows that came through StatementExtractionSchema cannot trip this; rows built
 * by hand elsewhere in the app can.
 */
function assertMinorUnits(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(
      `${label} must be integer minor units (poisha), got ${value}. ` +
        `Money is never a float — see src/lib/core/money.ts.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Culprits
// ---------------------------------------------------------------------------

export const CULPRIT_KINDS = [
  "sign_flip",
  "extra_row",
  "missing_row",
  "fee_mismatch",
  "amount_matches_gap",
] as const;
export type CulpritKind = (typeof CULPRIT_KINDS)[number];

export interface Culprit {
  /** Zero-based index into `extraction.rows`. Rendered one-based for humans. */
  rowIndex: number;
  row: ExtractedRow;
  kind: CulpritKind;
  /** 0–1. Only the exact-arithmetic kinds score above 0.7. */
  confidence: number;
  message: string;
}

/**
 * Name the rows that could account for the gap on their own.
 *
 * "Your statement didn't balance" is useless; "row 47 is a 845.50 debit that
 * was extracted as a credit" is actionable. Three exact-arithmetic signals do
 * nearly all the work:
 *
 *   delta === 2 × row's effect   → the direction is flipped (fixing it moves
 *                                  the computed balance by twice the amount)
 *   delta === row's effect       → the row should not be there at all
 *                                  (hallucinated, or a balance line counted
 *                                  as a transaction, or a duplicate)
 *   delta === −row's effect      → the row is in the sum but the statement
 *                                  does not have it once — i.e. it needs
 *                                  counting again, so a sibling row was missed
 *
 * These are exact integer identities, not heuristics: if one matches, the
 * arithmetic really does close by acting on that row.
 */
export function findLikelyCulprits(
  extraction: StatementExtraction,
  deltaMinor: number,
): Culprit[] {
  if (deltaMinor === 0) return [];

  const currency = extraction.currency ?? "BDT";
  const culprits: Culprit[] = [];

  extraction.rows.forEach((row, rowIndex) => {
    const effect = rowEffect(row);
    const amount = formatMoney(row.amountMinor, currency);
    const label = `Row ${rowIndex + 1} (${row.description || "no description"}, ${amount} ${row.direction})`;

    if (effect !== 0 && deltaMinor === 2 * effect) {
      culprits.push({
        rowIndex,
        row,
        kind: "sign_flip",
        confidence: 0.9,
        message:
          `${label} looks like a flipped direction — recording it as a ` +
          `${row.direction === "credit" ? "debit" : "credit"} closes the gap exactly.`,
      });
      return;
    }

    if (effect !== 0 && deltaMinor === effect) {
      culprits.push({
        rowIndex,
        row,
        kind: "extra_row",
        confidence: 0.85,
        message:
          `${label} accounts for the whole gap on its own — it is probably a ` +
          `duplicate, or a balance/subtotal line read as a transaction.`,
      });
      return;
    }

    if (effect !== 0 && deltaMinor === -effect) {
      culprits.push({
        rowIndex,
        row,
        kind: "missing_row",
        confidence: 0.6,
        message:
          `${label} would close the gap if it were counted twice — a second, ` +
          `near-identical row was probably missed.`,
      });
      return;
    }

    if (row.feeMinor !== 0 && Math.abs(deltaMinor) === row.feeMinor) {
      culprits.push({
        rowIndex,
        row,
        kind: "fee_mismatch",
        confidence: 0.7,
        message:
          `${label} carries a ${formatMoney(row.feeMinor, currency)} fee that is exactly ` +
          `the size of the gap — the fee may be double-counted or missing.`,
      });
      return;
    }

    // Weakest signal: the magnitudes line up but no exact identity does. Still
    // worth surfacing, because it points at the right number to go look at.
    if (
      row.amountMinor !== 0 &&
      (Math.abs(deltaMinor) === row.amountMinor ||
        Math.abs(deltaMinor) === 2 * row.amountMinor)
    ) {
      culprits.push({
        rowIndex,
        row,
        kind: "amount_matches_gap",
        confidence: 0.5,
        message: `${label} has an amount matching the size of the gap.`,
      });
    }
  });

  return culprits.sort(
    (a, b) => b.confidence - a.confidence || a.rowIndex - b.rowIndex,
  );
}

/** How much this row moves the balance: credits up, debits and fees down. */
function rowEffect(row: ExtractedRow): number {
  const signed = row.direction === "credit" ? row.amountMinor : -row.amountMinor;
  return signed - row.feeMinor;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function failureMessage(
  extraction: StatementExtraction,
  computed: number,
  declared: number,
  delta: number,
  totals: ReconcileTotals,
  currency: string,
): string {
  const gap = formatMoney(Math.abs(delta), currency);
  const direction = delta > 0 ? "over" : "under";

  let message =
    `Reconciliation failed: replaying ${totals.rowCount} ` +
    `${plural(totals.rowCount, "row", "rows")} gives ${formatMoney(computed, currency)}, ` +
    `but the statement declares ${formatMoney(declared, currency)} — ` +
    `${gap} ${direction}.`;

  const culprits = findLikelyCulprits(extraction, delta);
  const strong = culprits.filter((c) => c.confidence >= 0.8);

  if (strong.length === 1) {
    message += ` ${strong[0].message}`;
  } else if (strong.length > 1) {
    message +=
      ` ${strong.length} rows could each account for the gap on their own: ` +
      `${strong.map((c) => `row ${c.rowIndex + 1}`).join(", ")}.`;
  }

  return message;
}

function notApplicableMessage(
  opening: number | null,
  closing: number | null,
  totals: ReconcileTotals,
  currency: string,
): string {
  const missing =
    opening === null && closing === null
      ? "no opening or closing balance"
      : opening === null
        ? "no opening balance"
        : "no closing balance";

  return (
    `Not verifiable: this document states ${missing}, so its ` +
    `${totals.rowCount} ${plural(totals.rowCount, "row", "rows")} cannot be proven. ` +
    `Net movement is ${formatMoney(netMovement(totals), currency)}. ` +
    `Treat these rows as provisional — statement data wins over them on conflict.`
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
