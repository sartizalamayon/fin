/**
 * Row <-> domain mapping.
 *
 * The database speaks snake_case and the domain speaks camelCase. Every
 * crossing happens here and nowhere else, so a column rename has exactly one
 * place to break — and everything in this file is pure, so it is all covered
 * by tests that need no database.
 */

import type { StatementDocument, Transaction } from "@/lib/core/types";

import type {
  CategoryTotal,
  DocumentRow,
  MonthlyTotal,
  NewDocument,
  NewTransaction,
  TransactionRow,
  UserSettings,
  UserSettingsRow,
  UserSettingsPatch,
} from "./types";

// ---------------------------------------------------------------------------
// Row -> domain
// ---------------------------------------------------------------------------

export function toStatementDocument(row: DocumentRow): StatementDocument {
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename,
    fileHash: row.file_hash,
    sourceKind: row.source_kind,
    provider: row.provider,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    openingBalanceMinor: row.opening_balance_minor,
    closingBalanceMinor: row.closing_balance_minor,
    reconcileStatus: row.reconcile_status,
    reconcileDeltaMinor: row.reconcile_delta_minor,
    rowCount: row.row_count,
    createdAt: row.created_at,
  };
}

export function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    documentId: row.document_id,
    occurredAt: row.occurred_at,
    amountMinor: row.amount_minor,
    direction: row.direction,
    currency: row.currency,
    refId: row.ref_id,
    counterparty: row.counterparty,
    description: row.description,
    provider: row.provider,
    accountRef: row.account_ref,
    feeMinor: row.fee_minor,
    balanceAfterMinor: row.balance_after_minor,
    category: row.category,
    rawText: row.raw_text,
    transferPairId: row.transfer_pair_id,
    createdAt: row.created_at,
  };
}

/**
 * Map settings, dropping the ciphertext.
 *
 * The encrypted Groq key is intentionally absent from UserSettings so it
 * cannot ride along into a JSON response. Callers that genuinely need the
 * plaintext go through getGroqApiKey().
 */
export function toUserSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    hasGroqKey: row.groq_api_key_encrypted !== null,
    groqKeyMasked: row.groq_key_masked,
    groqKeySetAt: row.groq_key_set_at,
    defaultCurrency: row.default_currency,
    timezone: row.timezone,
    monthlyBudgetMinor: row.monthly_budget_minor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Domain -> row (insert payloads)
// ---------------------------------------------------------------------------

/** Column order used by insertDocument. */
export const DOCUMENT_INSERT_COLUMNS = [
  "user_id",
  "filename",
  "file_hash",
  "source_kind",
  "provider",
  "period_start",
  "period_end",
  "opening_balance_minor",
  "closing_balance_minor",
  "reconcile_status",
  "reconcile_delta_minor",
  "row_count",
] as const;

export function documentToRow(input: NewDocument) {
  return {
    user_id: input.userId,
    filename: input.filename,
    file_hash: input.fileHash,
    source_kind: input.sourceKind,
    provider: input.provider,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    opening_balance_minor: input.openingBalanceMinor ?? null,
    closing_balance_minor: input.closingBalanceMinor ?? null,
    reconcile_status: input.reconcileStatus ?? "pending",
    reconcile_delta_minor: input.reconcileDeltaMinor ?? null,
    row_count: input.rowCount ?? 0,
  };
}

/** Column order used by insertTransactions. */
export const TRANSACTION_INSERT_COLUMNS = [
  "user_id",
  "document_id",
  "occurred_at",
  "amount_minor",
  "direction",
  "currency",
  "ref_id",
  "counterparty",
  "description",
  "provider",
  "account_ref",
  "fee_minor",
  "balance_after_minor",
  "category",
  "raw_text",
  "transfer_pair_id",
] as const;

/**
 * Defaults mirror the zod defaults in core/types.ts, so a row built here and a
 * row parsed by TransactionSchema agree.
 */
export function transactionToRow(input: NewTransaction) {
  return {
    user_id: input.userId,
    document_id: input.documentId ?? null,
    occurred_at: input.occurredAt,
    amount_minor: input.amountMinor,
    direction: input.direction,
    currency: input.currency ?? "BDT",
    ref_id: input.refId ?? null,
    counterparty: input.counterparty ?? null,
    description: input.description,
    provider: input.provider,
    account_ref: input.accountRef ?? null,
    fee_minor: input.feeMinor ?? 0,
    balance_after_minor: input.balanceAfterMinor ?? null,
    category: input.category ?? null,
    raw_text: input.rawText,
    transfer_pair_id: input.transferPairId ?? null,
  };
}

/** Every settings column is one of these — narrow enough for postgres.js to bind. */
export type SettingsColumnValue = string | number | Date | null;

/**
 * Translate a settings patch into columns, preserving the difference between
 * "not mentioned" (leave the stored value alone) and "explicitly null" (clear
 * it). A plain `?? null` would collapse the two and wipe fields the caller
 * never asked to change.
 *
 * `undefined` counts as not mentioned, so `{ timezone: undefined }` from an
 * optional-chained caller is inert rather than destructive.
 */
export function userSettingsPatchToRow(
  patch: UserSettingsPatch,
): Record<string, SettingsColumnValue> {
  const row: Record<string, SettingsColumnValue> = {};

  if (patch.defaultCurrency !== undefined) {
    row.default_currency = patch.defaultCurrency;
  }
  if (patch.timezone !== undefined) {
    row.timezone = patch.timezone;
  }
  if (patch.monthlyBudgetMinor !== undefined) {
    row.monthly_budget_minor = patch.monthlyBudgetMinor;
  }
  if (patch.groqApiKeyEncrypted !== undefined) {
    row.groq_api_key_encrypted = patch.groqApiKeyEncrypted;
  }
  if (patch.groqKeyMasked !== undefined) {
    row.groq_key_masked = patch.groqKeyMasked;
  }
  if (patch.groqKeySetAt !== undefined) {
    row.groq_key_set_at = patch.groqKeySetAt;
  }

  return row;
}

// ---------------------------------------------------------------------------
// Aggregate shaping
// ---------------------------------------------------------------------------

export interface MonthlyTotalRow {
  month: string;
  credit_minor: number;
  debit_minor: number;
  fee_minor: number;
  transaction_count: number;
}

/** net = credits − debits − fees. Computed here, not in SQL, so it is tested. */
export function toMonthlyTotal(row: MonthlyTotalRow): MonthlyTotal {
  return {
    month: row.month,
    creditMinor: row.credit_minor,
    debitMinor: row.debit_minor,
    feeMinor: row.fee_minor,
    netMinor: row.credit_minor - row.debit_minor - row.fee_minor,
    transactionCount: row.transaction_count,
  };
}

export interface CategoryTotalRow {
  category: CategoryTotal["category"];
  total_minor: number;
  transaction_count: number;
}

/**
 * Attach each category's share of the grand total, for donut/bar labels.
 * A zero grand total yields zero shares rather than NaN.
 */
export function toCategoryTotals(rows: CategoryTotalRow[]): CategoryTotal[] {
  const grandTotal = rows.reduce((sum, row) => sum + row.total_minor, 0);

  return rows.map((row) => ({
    category: row.category,
    totalMinor: row.total_minor,
    transactionCount: row.transaction_count,
    share: grandTotal === 0 ? 0 : row.total_minor / grandTotal,
  }));
}

// ---------------------------------------------------------------------------
// Batch helpers
// ---------------------------------------------------------------------------

/**
 * Collapse rows that would collide on the (user_id, provider, ref_id) unique
 * index, keeping the first occurrence.
 *
 * The index already rejects duplicates, but a batch containing the same
 * TrxID twice makes the ON CONFLICT outcome depend on statement internals and
 * makes the "skipped" count meaningless. Deduping up front keeps the result
 * deterministic. Rows with no ref id are always kept — they are legitimately
 * repeatable (two ৳50 bus fares on one day are two real transactions).
 */
export function dedupeByRefKey<
  T extends { userId: string; provider: string; refId?: string | null },
>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const row of rows) {
    if (row.refId == null || row.refId === "") {
      out.push(row);
      continue;
    }
    const key = `${row.userId} ${row.provider} ${row.refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

/** Split a list into fixed-size chunks so bulk inserts stay under the
 * 65535 bind-parameter ceiling. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}
