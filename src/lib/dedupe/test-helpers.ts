import type {
  ExtractedRow,
  StatementDocument,
  Transaction,
} from "../core/types";

/**
 * Fixture builders for the dedupe suite. Test-only — nothing in the app imports
 * this. Ids are deterministic so that tie-breaking assertions stay stable.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";

let counter = 0;

/** Call from `beforeEach` when a test asserts on generated ids. */
export function resetFixtureIds(): void {
  counter = 0;
}

/** Deterministic, schema-valid v4-shaped uuid. */
export function nextUuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

/** Terse date literal for fixtures. Instants only — no timezone semantics. */
export function at(iso: string): Date {
  return new Date(iso);
}

export function makeRow(overrides: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    occurredAt: at("2026-02-10T10:00:00Z"),
    amountMinor: 5000,
    direction: "debit",
    currency: "BDT",
    refId: null,
    counterparty: null,
    description: "Payment",
    provider: "bkash",
    accountRef: null,
    feeMinor: 0,
    balanceAfterMinor: null,
    rawText: "",
    ...overrides,
  };
}

export function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  const row = makeRow();
  return {
    id: nextUuid(),
    userId: USER_ID,
    documentId: null,
    ...row,
    category: null,
    transferPairId: null,
    createdAt: at("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeDoc(overrides: Partial<StatementDocument> = {}): StatementDocument {
  return {
    id: nextUuid(),
    userId: USER_ID,
    filename: "statement.pdf",
    fileHash: "0".repeat(64),
    sourceKind: "statement_pdf",
    provider: "bkash",
    periodStart: at("2026-01-01T00:00:00Z"),
    periodEnd: at("2026-03-31T23:59:59Z"),
    openingBalanceMinor: null,
    closingBalanceMinor: null,
    reconcileStatus: "pending",
    reconcileDeltaMinor: null,
    rowCount: 0,
    createdAt: at("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
